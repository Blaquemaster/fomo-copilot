# Owner runbook

This is the only deployment plan. It is not a deployment. Nothing in this branch contacts the server, merges, or starts paper.

The release candidate is the branch `cursor/release-candidate-8ff7`. It contains the held stack through this change. CI builds the ingestor image and records its id in `release-digest.json` and in the compose-gates log line `release digest`. That id is the only image a later deploy may start. There is no schema-compatible fallback image. Rollback is forward-fix-only.

## What you can approve now

A bounded rollout and a diagnostic collection:

- One merge of this release candidate. The merge does not deploy. See below.
- An off-host backup while the current ingestor is still running.
- Loading the tested image, installing the rollback controller, and one ingestor replacement.
- A diagnostic phase: reference scans, reconciliation, and quote collection. Paper and alerts stay off. The 7-day qualification clock stays off. No venue is chosen.

## What waits for a later yes

- Freezing a venue.
- Freezing a wallet-list version.
- Creating a qualification run.
- Starting the 7-day clock.
- Inferential scoring. The 60-day, variable-volume, heavy-tail calibration is still pending.
- Turning on wide recovery.
- Any new paid service. The $150 figure stays a proposal.

## Why merging this branch does not deploy

`.github/workflows/deploy.yml` has no `push` trigger. GitHub reads the workflow from the commit that was just pushed. The merge commit's workflow only listens for `workflow_dispatch`, so the merge does not start a deploy, and later pushes do not either.

A dispatch that is already running is not cancelled: `concurrency.group` is `deploy-production` and `cancel-in-progress` is `false`. A second dispatch waits until the first finishes, including a migration.

The dispatch starts work only when both of these are true:

- `confirm` is `promote-tested-digest`
- `image_digest` is the `sha256:` id recorded by the green CI run

Anything else exits before SSH. The job does not build from the checkout. It starts the image id that was loaded on the server.

## Server steps that need your yes

Do these yourself, in order, after you approve the bounded rollout. The agent does not run them.

1. Confirm CI on `cursor/release-candidate-8ff7` is green. Copy the ingestor image id from `release digest` in the compose-gates log, and save the CI image tar if you exported one (`docker save` of that id).
2. On the droplet, while the current ingestor is still running, dump the database and the roles. Copy both files off the machine. A dump is a snapshot: restoring it later discards ingestion that happened after the dump.

```bash
cd /opt/fomo-copilot
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U fomo -d fomo -Fc > "/var/backups/fomo-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  pg_dumpall -U fomo --roles-only > "/var/backups/fomo-roles-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

3. Merge this release candidate into `main`. Wait and confirm no deploy workflow started.
4. Install the rollback controller outside the checkout, then load the tested image and confirm the id:

```bash
sudo bash scripts/install-rollback-controller.sh
docker load < release-ingestor.tar
docker image inspect sha256:THE_RECORDED_ID >/dev/null
```

`sudo` is only for creating `/usr/local/lib/fomo` and `/etc/fomo`. The controller and the preflight command do not need root after that. The installed manifest is forward-fix-only: `targets` is empty. The command stops services and asks for a forward fix. It will not start an older image. The production image from before this release has not been tested against migrations through `031_run_identity`.

5. Dispatch the deploy workflow with `image_digest` set to that id and `confirm` set to `promote-tested-digest`. The workflow writes `AUTOBUY_MODE=dry_run` into the env file before it starts the container. It does not fix the mode afterward. `live` is refused. It stops the screener and the alerter, leaves Postgres running, and runs `docker compose up -d --no-deps --no-build ingestor` with the loaded image.
6. Record the replacement with `scripts/replace-ingestor.sh` if you run the replacement by hand instead of the dispatch. Pull or load the image first. The script records checkpoint counts, the interruption time, and that wide recovery is disabled. An unrecovered gap stays recorded and blocks readiness. Do not delete checkpoint rows.
7. Start the diagnostic phase only. Do not start paper, alerts, or the qualification clock.

## Migrations

Production `main` at `6555907` has applied `001_ingest` through `022_sniper_created_slot` (`infra/db/production-baseline.txt`). This release's `migrate()` also records `023_scale_booking` through `031_run_identity`.

Read-only inventory, from a file of ids or from a `schema_migrations` listing. It does not write:

```bash
node scripts/migration-inventory.mjs \
  --release-source packages/core/src/db/ingest.ts \
  --applied infra/db/production-baseline.txt
```

`migrate()` uses one transaction. `lock_timeout` is 3 seconds and `statement_timeout` is 60 seconds. If either fires, the catch block rolls that transaction back. None of the new ids are committed. It is not a per-migration commit. The statements are idempotent, so one rerun after a timeout is safe. Do not loop on a failure.

CI rehearses this on a synthetic copy: a new database whose `schema_migrations` table contains only the production ids, then `migrate()`, then `pg_dump -Fc`, `pg_dumpall --roles-only`, and `pg_restore` into a second database. That rehearsal is not a copy of production data. The production dump in step 2 is the one that matters, and it happens only when you say so.

## Live preflight

Exact command, on the host, as a user who can already run docker. No sudo. It does not open a remote host.

```bash
bash scripts/preflight.sh --live \
  --accepted /etc/fomo/preflight-accepted.json \
  --project fomo-copilot \
  --env-file /opt/fomo-copilot/.env \
  --file infra/docker-compose.yml \
  --service ingestor \
  --shadow-user fomo_shadow
```

The accepted file's `imageDigest` and `configFingerprint` must be the digest and config that were just deployed. The probe binds the report to the running image id and the config row. Evidence older than 15 minutes is rejected. The shadow insert runs inside a transaction that is rolled back even when the role is allowed to insert, and the probe mint must be absent afterward. A successful prohibited write still fails the checker, because the role must not be allowed to insert.

The 7-day clock starts only after a later live preflight passes and the later yes items are set. Diagnostic days do not count.

## Diagnostic phase

Permitted jobs: reference scans, reconciliation, and quote collection under the restricted role. Paper and alerts stay off. The qualification clock stays inhibited.

Candidate venues, none selected: `pump`, `pumpswap`, `launchlab`, `meteora`.

Observation window: 7 days from diagnostic start. The same wallet cohort is used for every candidate venue. It is the list loaded at the start. It is not rotated during the window. It is not a frozen qualification version yet.

A venue is judged only on operations:

- lifecycle and migration events captured with a completed independent reference scan and an explicit denominator
- wallet-swap coverage and a complete activity history for the fixed cohort
- parses that match the stored events
- usable quotes at the $20 allocation and the 10% round-trip cap
- enough contemporaneous matched opportunities to fill the strata
- latency and backlog inside the collection window
- collection cost inside the cap

Returns, winners, and wallet outperformance are not criteria. If two venues meet every operational bar, the tie-breaker is the larger completed reference-scan denominator. If that is also tied, stop and ask. Do not pick a winner from returns.

Few reference events are weak evidence. If no venue passes, stop. Do not loosen a bar.

Stop the diagnostic if paper or alerts would turn on, if wide recovery would be enabled, if a prohibited write succeeds, or if continuing would need a new paid service or Helius overage.

Cost against the $150 proposal: the droplet is $6 a month, so 7 days of host time is about $1.40. This phase adds no new API subscription. Public-RPC reference scans add no Helius charge. Existing credit caps still pause intake. $150 is not approved as new spend by this runbook.

Activation order, and the clock is not eligible until the last step, which is a later decision:

1. Diagnostic start, after the bounded replacement is up and paper and alerts are stopped.
2. Live verification with the command above, bound to the deployed digest and config.
3. Clock eligibility, only after you separately freeze the venue, freeze the wallet-list version, and a fresh live preflight passes. Days collected before that do not count.
