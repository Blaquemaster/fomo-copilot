# Owner runbook

This is the only deployment plan. It is not a deployment. Nothing in this branch contacts the server, merges, or starts paper.

The release candidate is the branch `cursor/release-candidate-8ff7`. It contains the held stack through this change. CI builds the ingestor image and records its id in `release-digest.json` and in the compose-gates log line `release digest`. That id is the only image a later deploy may start. There is no schema-compatible fallback image. Rollback is forward-fix-only.

## What you can approve now

Conditional on the checks in this revision: a bounded rollout and a diagnostic collection. Steps 1 through 7 below are the approval checklist. Do not dispatch until the pre-dispatch restore has succeeded.

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

Do these yourself, in order, after you approve the bounded rollout. The agent does not run them. A failed condition stops that step.

0. Before step 1, and again after the merge, run the live deploy-queue check. Do not merge while it aborts.

```bash
bash scripts/pre-merge-deploy-check.sh
```

1. Merge this release candidate into `main` only after that check prints `no queued or running deployment`.
2. Post-merge confirmation: run `bash scripts/pre-merge-deploy-check.sh` again and look at Actions. No deploy workflow may have started. The workflow has no push trigger, so a started run is a stop.
3. On the droplet, while the current ingestor is still running, dump the database and the roles. Copy both files off the machine. A dump is a snapshot: restoring it later discards ingestion that happened after the dump.

```bash
cd /opt/fomo-copilot
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U fomo -d fomo -Fc > "/var/backups/fomo-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file .env -f infra/docker-compose.yml exec -T postgres \
  pg_dumpall -U fomo --roles-only > "/var/backups/fomo-roles-$(date -u +%Y%m%dT%H%M%SZ).sql"
```

4. Install the rollback controller outside the checkout. Do not load a rebuilt image in place of the recorded reference:

```bash
sudo bash scripts/install-rollback-controller.sh
```

`sudo` is only for creating `/usr/local/lib/fomo` and `/etc/fomo`. The controller and the preflight command do not need root after that. The installed manifest is forward-fix-only: `targets` is empty. The command stops services and asks for a forward fix. It will not start an older image. The production image from before this release has not been tested against migrations through `031_run_identity`.

5. Publish the recorded registry reference yourself. This repository does not push it. Then verify the pull for `linux/amd64` before any replacement. The droplet is Ubuntu on DigitalOcean amd64, the same architecture as the CI runner. A failed pull, a changed digest, or a rebuilt image stops the sequence. The script does not start the ingestor.

```bash
bash scripts/verify-published-image.sh \
  --reference 'ghcr.io/blaquemaster/fomo-copilot/ingestor@sha256:THE_INDEX_DIGEST' \
  --expected-image-id 'sha256:THE_CI_IMAGE_ID'
```

6. On the host, before any other script runs, verify the reviewed revision:

```bash
git checkout "$(node -e 'process.stdout.write(require("./infra/release-pins.json").revision)')"
bash scripts/verify-release-pins.sh
bash scripts/pre-merge-deploy-check.sh
```

`verify-release-pins.sh` checks the compose file and the host scripts. A mismatch stops you. `pre-merge-deploy-check.sh` lists queued and running deploy workflow runs and aborts if any exist, and it aborts if `deploy.yml` has a push trigger.

Dispatch only after the publish check prints `replacement may start`. `confirm` must be `promote-tested-digest`. The workflow pulls that same reference. It writes `AUTOBUY_MODE=dry_run` before the container starts. `live` is refused. It stops the screener and the alerter, leaves Postgres running, and starts only that pulled image.

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

**Stop: probes.** Before diagnostics, install the restricted shadow role and run the live probes against the deployed image. A failed probe stops diagnostics. It does not stop the ingestor.

```bash
bash scripts/preflight.sh --live \
  --accepted /etc/fomo/preflight-accepted.json \
  --project fomo-copilot \
  --env-file /opt/fomo-copilot/.env \
  --file infra/docker-compose.yml \
  --service ingestor \
  --shadow-user fomo_shadow
```

8. Start the diagnostic phase only after that probe passes. Do not start paper, alerts, or the qualification clock.

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

Hard ceilings, rejected by config if set higher: 50,000 Helius credits, 2,000 Jupiter quotes a day, 20,000 public-RPC calls a day, and the $25 ceiling. The 50,000 credits are diagnostic additions only. They do not include the ingestor's existing stream. The weights are the documented Helius method costs: 1 credit for `getSlot`, `getTransaction`, and `getSignaturesForAddress`, 1 credit for a parsed event, and 10 credits plus 1 per scanned page for a parsed-events scan. Hitting a ceiling stops reference scans, reconciliation, and quote collection. It does not stop the existing ingestor. The counters are rows in Postgres, shared by every diagnostic process, and they remain after a restart. A denied retry does not add another unit.

## External APIs and the cost ceiling

- Helius parsed websocket and HTTPS RPC (`mainnet.helius-rpc.com`, `beta.helius-rpc.com`): the running ingestor. Parsed events are 1 credit. `getSlot`, `getTransaction`, and `getSignaturesForAddress` are 1 credit. A parsed-events scan is 10 credits plus 1 per page. The existing plan pauses at 90 percent of 10,000,000 credits. The diagnostic ceiling is the tighter 50,000 credits.
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
