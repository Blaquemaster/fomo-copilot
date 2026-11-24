# Deployment acceptance plan

This is the plan for the owner. It is not a deployment. Nothing in this branch contacts the server, starts paper, or sends an alert. Merge these pull requests only after reading this plan. Merging to `main` starts `.github/workflows/deploy.yml` when the deploy secrets are present.

## Owner choices still open

These stay unset until the owner decides. The qualification clock and the 7-day shadow clock stay stopped while any of them is open, and while preflight has not passed.

- Venue scope (`EXPERIMENT_VENUES`). Which venue is not known. One validated venue is enough, and the allowlist is empty until it is named.
- Wallet-list version. Counted qualification has no run id until this is set.
- Research cap. $150 is a proposal. It needs an explicit yes. This plan adds no paid service.
- The production image digest that is allowed as a rollback target. That digest is recorded on the host after a stopped deploy, in the rollback manifest. It is not invented here.

Inferential scoring stays disabled. The full procedure (a 60-day window, variable volume, and heavy tails) is not calibrated. Wide recovery stays off: `INGEST_WIDE_RECOVERY` remains unset, and a gap wider than about 600 slots stays unrecovered.

## Merge order

Merge from the bottom of the stack upward, one pull request at a time, after CI on that pull request is green. Each merge to `main` deploys. Take the database dump in the next section before the first merge.

| Order | Pull request      | Branch                             | What lands                                                                   |
| ----- | ----------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| 1     | #50               | `cursor/durable-stopped-8ff7`      | Screener and alerter stay stopped unless the flags are the exact word `true` |
| 2     | #51               | `cursor/experiment-v2-prereg-8ff7` | Pre-registered protocol                                                      |
| 3     | #40               | `cursor/scale-out-booking-8ff7`    | Scale-out accounting. First new migration in this stack, `023_scale_booking` |
| 4     | #42               | `cursor/dead-unpriced-8ff7`        | Dead and unpriced exits                                                      |
| 5     | #44               | `cursor/entry-gating-8ff7`         | Entry impact cap                                                             |
| 6     | #45               | `cursor/cost-model-8ff7`           | Route cost model. The route itself stays unknown                             |
| 7     | #46               | `cursor/wallet-signal-8ff7`        | Frozen wallet list                                                           |
| 8     | #47               | `cursor/wallet-fill-amounts-8ff7`  | High risk: wallet fill quantities                                            |
| 9     | #48               | `cursor/candidate-log-8ff7`        | Candidate log                                                                |
| 10    | #49               | `cursor/feed-telemetry-8ff7`       | High risk: backfill source, gaps, and feed alerts                            |
| 11    | #53               | `cursor/experiment-rules-8ff7`     | Measurement rules                                                            |
| 12    | #54               | `cursor/experiment-complete-8ff7`  | Experiment measurement path                                                  |
| 13    | #55               | `cursor/wide-recovery-8ff7`        | High risk: ingestor recovery past 600 slots. The flag stays unset            |
| 14    | #56               | `cursor/review-3-8ff7`             | Measurement, isolation, and the CI shadow role                               |
| 15    | this pull request | `cursor/review-6-acceptance-8ff7`  | Rollback manifest, identification bounds, preflight                          |

Leave these unmerged. They are not part of this stack:

- #41, the production role plan. The shadow role below is `infra/db/shadow-roles.sql`, applied by hand after the dump.
- #39 and the dependency-update pull requests.

## Dump first

On the droplet, before merging #50, while the server is still on current `main`:

1. Confirm the screener and the alerter are stopped.
2. Write a custom-format dump outside the container and copy it off the droplet. Record the path and the time.

```bash
cd /opt/fomo-copilot
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U fomo -d fomo -Fc > "/var/backups/fomo-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Do not start the next merge until that file exists off the machine. Do not drop tables to undo a later migration. A restore from this dump is the way back to the schema from before this stack.

## Deploy in the stopped state

The workflow starts only `postgres` and `ingestor` when `PAPER_ENABLED` and `ALERTS_ENABLED` are not both the exact word `true`. Leave the GitHub variables unset. After every deploy in the list above:

- `docker compose ps` shows the screener and the alerter stopped.
- The outcome worker and the shadow runner are not started.
- `INGEST_WIDE_RECOVERY` is unset.

The ingestor is the high-risk process. Its startup runs the migrations. From #40 onward that startup applies the new statements, through `031_run_identity` once this stack is fully merged. The migration sets `lock_timeout` to 3 seconds and `statement_timeout` to 60 seconds. If either fires, that transaction rolls back and the previous schema stays. The statements are idempotent, so one rerun after a timeout is safe. Do not loop on a failure.

`028_wide_recovery` creates checkpoint columns. Applying that schema does not turn the wide path on. With the flag unset, a gap wider than about 600 slots is stored as unrecovered. Leave the flag unset. Do not delete `raw_events` or checkpoint rows.

## Re-apply AUTOBUY_MODE=dry_run

The workflow writes `AUTOBUY_MODE` from the GitHub variable. The default when that variable is unset is `off`. After the env file is installed, and before treating the deploy as finished, set the live value back to dry run:

```bash
cd /opt/fomo-copilot
grep '^AUTOBUY_MODE=' .env
# If the line is not dry_run, replace it and restart only the ingestor.
sed -i 's/^AUTOBUY_MODE=.*/AUTOBUY_MODE="dry_run"/' .env
grep '^AUTOBUY_MODE="dry_run"$' .env
docker compose --env-file .env -f infra/docker-compose.yml up -d --no-deps ingestor
```

Confirm the file does not contain `AUTOBUY_MODE="live"`. Leave `AUTOBUY_KILL` off. Do this after every deploy in the merge list, because each deploy rewrites `.env`.

## Rollback command

The supported command is the host script `scripts/approved-rollback.sh`. It refuses to run inside a container, so replacing the app image does not remove the check. Age is not a reason to start an image.

The manifest on the host lists each allowed target with:

- the exact image id (`sha256:…` from `docker image inspect`)
- the migration ids that image can run
- the services it may start
- the modes, with `paper`, `alerts`, and `wideRecovery` set to false
- `gateTestsPassed: true` and evidence `verify` and `compose-gates`

After #50 has deployed and the screener has stayed stopped, record that image id as the first approved fallback. Do not list the image from before #50. That older image can lack the stop gate. The command rejects any target that is not an approved entry, and it does that before it runs the target. The CI fixture for this is the unguarded image: the command exits 3, and that image is not started.

If the manifest has no approved entry, the command stops the screener, alerter, outcome worker, and shadow runner, prints `forward fix required`, and does not start a replacement. Build a forward image, put its digest in the manifest, and deploy that. Do not start an unlisted image to get the process back.

A previous image whose schema requirements do not include migrations that are already applied is not an approved fallback. Leave the new tables in place.

## Shadow role

Apply this after the schema from this stack exists and the dump is stored. Do not apply #41 as part of the merge list.

1. Set the password out of band. Replace `<POSTGRES_DB>` in `infra/db/shadow-roles.sql`.
2. Apply that file as the database owner.
3. Point only the shadow env file at `fomo_shadow`. The ingestor, screener, and alerter keep the owner URL.
4. The preflight probe must show that this role cannot insert into `phasec_position`, `phasec_alert`, or `autobuy_intent`.

The CI role `fomo_shadow_ci` exists only on the CI database. It is not the production role. Applying the role does not start the shadow runner.

## Preflight, then the 7-day clock

The live command is read-only. It uses the local docker socket and `docker compose exec` into postgres. It does not use sudo, and it does not open a remote host. This change does not run it against the server. CI runs it against the CI compose project only.

Exact command, from the checkout, as a user who can already run docker:

```bash
bash scripts/preflight.sh --live \
  --accepted /etc/fomo/preflight-accepted.json \
  --project fomo-copilot \
  --env-file /opt/fomo-copilot/.env \
  --file infra/docker-compose.yml \
  --service ingestor \
  --shadow-user fomo_shadow
```

The probes gather:

- the running image id of the named service, from `docker inspect`
- the latest `phasec_config_history` fingerprint, its venue allowlist, and its wallet-list version, which must match `phasec_wallet_list_version`
- the single non-null `phasec_execution.run_id`
- one `INSERT` into `phasec_position` as the shadow role, inside a transaction that is rolled back, including when the insert is denied
- the latest `ingest_recall_audit` row and one stored `phasec_observation` joined to `phasec_quote_attempt`
- `phasec_score_shadow` lookback start and end
- the age of that recall row and of `ingest_status.updated_at`
- `INGEST_WIDE_RECOVERY` on the running containers, and any wide checkpoint whose `recovery_completed_at` is set

Those facts are passed to the same checker as the file mode. The command exits 0 only when every line matches the accepted file:

- the running image digest
- the config fingerprint
- the run id
- the venue scope chosen above
- the wallet-list version chosen above
- a permission probe where the prohibited shadow writes fail
- one reference reconciliation and one stored quote observation through the ingestor and the outcome worker
- lookback history complete
- the reference reconciliation schedule and the freshness schedule both running
- wide recovery disabled, and a wide gap handled as unrecovered

`shadowClock` stays stopped until that exit. It is a 7-day clock. It also stays stopped while the qualification gate sees an empty venue scope, an unset wallet-list version, or a failed preflight. Passing preflight does not enable inferential Go, paper, or alerts.
