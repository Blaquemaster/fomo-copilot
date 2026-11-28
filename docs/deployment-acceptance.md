# Owner runbook

This is the only deployment plan. It is not a deployment. Nothing in this branch contacts the server, merges, or starts paper.

The release is pull request #60, branch `cursor/release-main-8ff7`, into `main`. Later commits need their own artifact. The digest from #60 does not cover them. Close pull requests #50, #51, #52, #53, #54, #55, #56, #57, #58, and #59 without merging them. #59 targets `cursor/release-candidate-8ff7`, not `main`. The push CI run of the merged commit records the registry reference `repository@sha256:...` in `release-digest.json` and the candidate SHA, current `main` SHA, and source tree hash in `release-handoff.json`. Use the reference whose `commit` equals that head. There is no schema-compatible fallback image. Rollback is forward-fix-only.

Before the merge, disable the Deploy workflow that is already on `main`:

```bash
CONFIRM=hold-production-deploy bash scripts/hold-deploy-workflow.sh --disable
```

After the merge, `scripts/check-merged-tree.sh --tree <reviewed-tree> --ref origin/main` must pass. The merge commit id may differ. The tree hash must equal the reviewed candidate.

## What you can approve now

Conditional on the checks in this revision: a bounded rollout and a diagnostic collection. Steps 0 through 8 below are the approval checklist, including the named stops for schema drift and the live probes. Do not dispatch until the publish check prints `replacement may start` and the pre-dispatch restore has succeeded.

- One merge of the direct-to-main pull request. The merge does not deploy. See below.
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

`.github/workflows/deploy.yml` and `.github/workflows/publish.yml` have no `push`, `pull_request`, `workflow_run`, `workflow_call`, `repository_dispatch`, or `schedule` trigger, and no workflow calls `deploy.yml`. Ordinary CI may still run on push. GitHub reads the workflow from the commit that was just pushed. The merge commit's Deploy workflow only listens for `workflow_dispatch`, so the merge does not start a deploy, and later pushes do not either. Disable the Deploy workflow that is already on `main` before the merge, because that older file still has a push trigger. `scripts/check-deploy-triggers.mjs` checks this tree.

A dispatch that is already running is not cancelled: `concurrency.group` is `deploy-production` and `cancel-in-progress` is `false`. A second dispatch waits until the first finishes, including a migration.

The dispatch starts work only when both of these are true:

- `confirm` is `promote-tested-digest`
- `image_digest` is the registry reference `ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:...` recorded by the green push run

Anything else exits before SSH. The job does not build from the checkout. It pulls that registry reference and starts that image.

## Server steps that need your yes

Do these yourself, in order, after you approve the bounded rollout. The agent does not run them. A failed condition stops that step.

0. One-time, as root, before any of the later steps. This does not remove root or any other administrator. Confirm the new login before changing any other access. Do not apply `infra/db/shadow-roles.sql` here.

```bash
sudo bash scripts/setup-deploy-user.sh /root/.ssh/id_ed25519.pub
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper rehearse
```

The script creates `fomo-deploy` with a locked password and one SSH key. It does not add that user to the `docker` group and it does not grant the Docker socket. It installs a root-owned helper at `/usr/local/lib/fomo/fomo-deploy-helper` and one sudoers line for that file. The helper accepts only `rehearse`, `backup`, `promote`, `install-rollback`, `preflight`, or `report`. The digest comes from root-owned `/etc/fomo/deploy-authorization.json`. The compose project is `fomo-copilot`, the compose file is `/etc/fomo/docker-compose.yml`, the context is `default`, the volume is `fomo-copilot_pgdata`, and the services are `postgres` and `ingestor`. A different account, checkout directory, `DOCKER_HOST`, or `COMPOSE_PROJECT_NAME` does not select another stack. This is not rootless Docker. Running the script again changes nothing.

Before step 1, disable the existing Deploy workflow and run the live queue check. Do not merge while either one aborts. Repeat the queue check after the merge.

```bash
CONFIRM=hold-production-deploy bash scripts/hold-deploy-workflow.sh --disable
bash scripts/pre-merge-deploy-check.sh
```

1. Merge pull request #60 into `main` only after that check prints `no queued or running deployment`. Then confirm the tree:

```bash
bash scripts/check-merged-tree.sh --tree THE_TREE_HASH --ref origin/main
```

Dispatch Publish with that push run's id and the `release-oci` artifact id, and confirm `publish-tested-artifact`. The workflow downloads that artifact, computes the checksum, and stops if the archive is missing, expired, altered, or from another run. It copies the OCI archive into GHCR without rebuilding, then sets the package `fomo-copilot/ingestor` to public so the droplet can pull anonymously. No registry token is stored in this repo. That dispatch has not been run. As root, put the published digest into `/etc/fomo/deploy-authorization.json`. Do not dispatch Deploy. 2. Post-merge confirmation: run `bash scripts/pre-merge-deploy-check.sh` again and look at Actions. No deploy workflow may have started. The workflow has no push trigger, so a started run is a stop. 3. On the droplet, while the current ingestor is still running, dump the database and the roles. Copy both files off the machine. A dump is a snapshot: restoring it later discards ingestion that happened after the dump.

```bash
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper backup
```

The dump is written under `/home/fomo-deploy/backups`. Copy both files off the machine. A dump is a snapshot: restoring it later discards ingestion that happened after the dump.

4. Install the rollback controller outside the checkout. Do not load a rebuilt image in place of the recorded reference:

```bash
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper install-rollback
```

The helper copies the controller from root-owned `/usr/local/lib/fomo/rollback-src`. The deploy user cannot write that directory. The installed manifest is forward-fix-only: `targets` is empty. The command stops services and asks for a forward fix. It will not start an older image. The production image from before this release has not been tested against migrations through `031_run_identity`.

5. Publish the recorded registry reference yourself. This repository does not push it. Then verify the pull for `linux/amd64` before any replacement. The droplet is Ubuntu on DigitalOcean amd64, the same architecture as the CI runner. A failed pull, a changed digest, or a rebuilt image stops the sequence. The script does not start the ingestor.

```bash
bash scripts/verify-published-image.sh \
  --reference 'ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:THE_INDEX_DIGEST' \
  --expected-image-id 'sha256:THE_CI_IMAGE_ID'
```

6. On the host, before any other script runs, verify the reviewed revision:

```bash
bash scripts/verify-release-pins.sh
bash scripts/pre-merge-deploy-check.sh
```

`verify-release-pins.sh` checks the compose file and the host scripts against `infra/release-pins.json`. The `revision` field is the commit SHA of those pinned files. A later commit may change only that field. A mismatch stops you. `pre-merge-deploy-check.sh` lists queued and running deploy workflow runs and aborts if any exist, and it aborts if `deploy.yml` or `publish.yml` has a push trigger.

Dispatch only after the publish check prints `replacement may start`. `confirm` must be `promote-tested-digest`. The workflow pulls that same reference. It writes `AUTOBUY_MODE=dry_run` before the container starts. `live` is refused. It stops the screener and the alerter, leaves Postgres running, and starts only that pulled image.

These references are not approvable. `verify-published-image.sh` and the deploy workflow refuse every digest in `infra/refused-digests.txt` before a pull or SSH, including:

- `ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:877b38b41fcf2e28bb1aa87488d37a301798992df4e2be63bddba30e3d65a4ed`
- `ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:766502c8029cded0d35ac946f6da35bbc46b5f3676fed0a7a5a0ee50e21aeec6`
- `ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:7e4d2735e9c23f6a1395457d9b17996938e49dbc89abc07487acdc3c4736c615`

The push CI run uploads `release-oci.tar`, `release-digest.json`, and `release-handoff.json` as artifact `release-oci` and keeps it for 90 days. `scripts/verify-release-handoff.sh` computes the archive checksum. GitHub's download warning is not the check. A mismatch, a missing file, or a different run stops publication. CI copies that archive into a local registry with `skopeo copy --all` and pulls the same digest. The copy does not rebuild.

Approve only the push-run `ingestorImage` whose `commit` equals the head of this revision.

**Stop: schema drift.** Before those migrations, read production `schema_migrations` with SELECT only and compare it to `infra/db/production-baseline.txt`.

```bash
bash scripts/halt-on-schema-drift.sh --applied /tmp/production-schema-migrations.txt
```

If that prints `sequence stopped: schema drift`, do not migrate and do not dispatch.

Then restore the production backup into an isolated Postgres 16 and apply migrations `023` through `031`:

```bash
bash scripts/restore-and-upgrade.sh --dump /var/backups/fomo-TIMESTAMP.dump --database fomo_cutover
```

A restore failure, a database that already has `031_run_identity`, or an upgrade failure prints `sequence stopped` and exits non-zero. Do not dispatch after that.

7. Record the replacement with `scripts/replace-ingestor.sh` if you run the replacement by hand instead of the dispatch. The image must already be the verified pull. The script records checkpoint counts, the interruption time, and that wide recovery is disabled. An unrecovered gap stays recorded and blocks readiness. Do not delete checkpoint rows.

**Approved role SQL.** Apply only this file, with psql, as the database owner. It is idempotent. It creates `fomo_shadow` as a non-superuser and grants only `ingest_month` reads plus the diagnostic spend tables. Set the password out of band. Do not apply `infra/db/shadow-roles.sql`. That file and the broader role migration stay out of this approval.

```bash
psql -v ON_ERROR_STOP=1 -d fomo -f infra/sql/fomo-shadow-diagnostic.sql
```

**Stop: probes.** Before diagnostics, run the live probes against the deployed image as `fomo_shadow`. A failed probe stops diagnostics. It does not stop the ingestor.

```bash
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper preflight
```

8. Start the diagnostic phase only after that probe passes. The database role is separate from the deploy user. Apply the SQL as an existing database administrator. The command is the ingestor image entrypoint under the restricted role, not a manual scan or a standalone quote script. The deploy user cannot open Docker, so an existing root operator starts this container:

```bash
docker run --rm --network fomo-copilot_internal \
  --env-file /opt/fomo-copilot/.env \
  -e DATABASE_URL='postgres://fomo_shadow:<password>@postgres:5432/fomo' \
  --entrypoint node \
  ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:THE_PUSH_RUN_DIGEST \
  apps/ingestor/dist/diagnostic.js
```

After the replacement, `sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper report`. A missing feed, checkpoint, or error stays `not recorded`. Do not fill it in.

The runner refuses to start unless its database role is `fomo_shadow` and that role is not a superuser. It charges the shared Postgres budget before every parsed-events scan, every public-RPC reconciliation request, and every Jupiter quote attempt, including a retry. A scan reserves the maximum pages its request budget can scan. The request sets `maxScannedTransactions` to 10,000, which is 20 credits, and a larger budget is not sent. After the response, the counter is reconciled to the pages actually scanned. If the budget database errors, or the charge is denied, the request is not sent. Exhaustion stops those three jobs. The existing ingestor keeps running. The qualification clock stays inhibited. A 90 percent Helius account-usage pause is an integrity failure for coverage even when diagnostic credits remain. Do not start paper or alerts.

## Migrations

Production `main` at `6555907` has applied `001_ingest` through `022_sniper_created_slot` (`infra/db/production-baseline.txt`). This release's `migrate()` also records `023_scale_booking` through `031_run_identity`.

Read-only inventory, from a file of ids or from a `schema_migrations` listing. It does not write:

```bash
node scripts/migration-inventory.mjs \
  --release-source packages/core/src/db/ingest.ts \
  --applied infra/db/production-baseline.txt
```

`migrate()` uses one transaction. `lock_timeout` is 3 seconds and `statement_timeout` is 60 seconds. If either fires, the catch block rolls that transaction back. None of the new ids are committed. It is not a per-migration commit. The statements are idempotent, so one rerun after a timeout is safe. Do not loop on a failure.

CI rehearses this on a synthetic copy: a new database whose `schema_migrations` table contains only the production ids, then `migrate()`, then `pg_dump -Fc`, `pg_dumpall --roles-only`, and `pg_restore` into a second database. That rehearsal is not a copy of production data. The production dump in step 3 is the one that matters, and it happens only when you say so.

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

## If the replacement fails

The old ingestor stays in place until the planned swap. Postgres, `raw_events`, checkpoints, and the failure log stay. Diagnostics stop. The qualification clock stays inhibited. A forward fix has to pass the same CI gates, including the long-running mock-feed replacement. Do not restore an older database snapshot to undo an application deploy: that snapshot would discard events stored after the backup.

With wide recovery off, any gap opened while ingestion is down stays unrecovered. Ingestion can remain down until a fixed release is built and pulled. An operator has to be available for the whole cutover.

## Diagnostic phase

Permitted jobs: reference scans, reconciliation, and quote collection under the restricted role. Paper and alerts stay off. The qualification clock stays inhibited.

The wallet-list version for this window is frozen now as `diagnostic-cohort-2026-11-24`. Load that cohort at the start and do not rotate it. It is not yet the qualification version.

The window is 24 hours of complete wallet-history warm-up, then 7 complete diagnostic days. The end time is fixed when the warm-up ends. There is one selection, at that end time. There is no automatic extension. The only early stop is an integrity failure or a budget ceiling.

Candidate sources, none selected. PumpSwap is the destination of a Pump graduation, not a second candidate:

- `pump`: program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, graduation `pump_migrate`, destination program `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` (PumpSwap).
- `launchlab`: program `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`, graduation `launchlab_migrate`.
- `meteora`: program `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, graduation `dbc_migration_damm_v2`, destination `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG`.

Each candidate needs at least 300 unique reference events in every critical class, including graduation or migration; at least 300 independently referenced wallet buys and 300 sells for the frozen cohort, counted across venues; and completed reference scans of the whole window on the 6-hour interval. The recall rule is only the exact-binomial one-sided 95 percent lower limit, and it has to be at least 99 percent. 300 of 300 is about 0.99006. 999 of 1000 is about 0.995265 and passes. 299 of 300 fails. Gap coverage and integrity are separate checks, named `gap` and `integrity`. A recall miss is `recall_below_99`. A tie among passers is `tie`. Do not treat every miss as one insufficient-evidence result. The tie-breaker runs only among venues that pass the recall bar and the gap check. Do not loosen a bar.

Hard ceilings, rejected by config if set higher: 50,000 Helius credits, 2,000 Jupiter quotes a day, 20,000 public-RPC calls a day, and the $25 ceiling. The 50,000 credits are diagnostic additions only. They do not include the ingestor's existing stream. Helius weights, by endpoint: the legacy Enhanced Transactions route (`GET https://api.helius.xyz/v0/addresses/{address}/transactions`) is 100 credits and the diagnostic does not call it; a Parsed Events scan (`POST https://mainnet.helius-rpc.com/v1/parsed-events/scan`) is 10 credits plus 1 per history page, and a 10,000-transaction request is reserved at 20 credits before it is sent; a Parsed Streams delivery (`parsedTransactionSubscribe`) is 1 credit per delivered event and belongs to the ingestor, not the diagnostic. Public RPC reconciliation is `getSignaturesForAddress` and is not a Helius credit. Hitting a ceiling stops reference scans, reconciliation, and quote collection. It does not stop the existing ingestor. The counters are rows in Postgres, shared by every diagnostic process, and they remain after a restart. A denied retry does not send another request. If the separate 90 percent account-usage guard pauses ingestion, that period is an integrity failure for coverage readiness, whatever diagnostic credits remain.

## External APIs and the cost ceiling

- Helius parsed websocket and HTTPS RPC (`mainnet.helius-rpc.com`, `beta.helius-rpc.com`): the running ingestor. A Parsed Streams delivery is 1 credit per event. `getSlot`, `getTransaction`, and `getSignaturesForAddress` are 1 credit. A Parsed Events scan is 10 credits plus 1 per history page, and the diagnostic reserves 20 credits for the 10,000-transaction maximum. The legacy Enhanced Transactions route is 100 credits and is not used by the diagnostic. The existing plan pauses at 90 percent of 10,000,000 credits, and that pause invalidates coverage readiness. The diagnostic ceiling is the tighter 50,000 credits on scan requests only.
- Public Solana RPC `https://api.mainnet-beta.solana.com`: venue reference scans. No Helius charge. Ceiling 20,000 calls a day.
- Jupiter `https://api.jup.ag/swap/v1/quote`: quote collection. Keyless limit is 30 requests a minute; the code stays at 24. Ceiling 2,000 quotes a day.
- DexScreener and GeckoTerminal are used by the screener market poll. The screener stays stopped, so the diagnostic does not call them.
- BSC `wss://bsc-rpc.publicnode.com` is the default Flap socket. Flap trading stays parked. The diagnostic does not add a paid BSC provider.

Expected volume is the existing quiet parsed subscription, one wallet-history warm-up inside the 3,300-credit run cap, 6-hour reference scans for three sources across 8 days, and the Jupiter ceiling. Host time for 8 days of the $6 droplet is about $1.60. If the 50,000 Helius credits are overage they are about $0.25 at $5 per million. The number to approve as the incremental-cost ceiling is **$25**. That is the stop. It is not an authorization to buy a new service, and it is below the $150 proposal.

## Diagnostic phase (jobs)

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

A recall miss, a gap miss, and an integrity miss are different stops. Do not loosen a bar and do not extend the window.

Stop the diagnostic if paper or alerts would turn on, if wide recovery would be enabled, if a prohibited write succeeds, or if a budget ceiling is hit. The incremental-cost ceiling for this approval is $25.

Activation order, and the clock is not eligible until the last step, which is a later decision:

1. Diagnostic start, after the bounded replacement is up and paper and alerts are stopped.
2. Live verification with the command above, bound to the deployed digest and config.
3. Clock eligibility, only after you separately freeze the venue, freeze the wallet-list version, and a fresh live preflight passes. Days collected before that do not count.
