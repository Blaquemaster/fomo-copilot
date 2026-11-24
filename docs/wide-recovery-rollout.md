# Wide recovery rollout and rollback

This change touches the ingestor. Do not merge it until the owner asks. Merging does not turn the wider backfill on. `INGEST_WIDE_RECOVERY` must be the exact word `true`, and it is unset.

## Schema and startup, separate from the feature

The next ingestor start runs the migrations, including `028_wide_recovery` and `029_review3_records`. That start sets `lock_timeout` to 3 seconds and `statement_timeout` to 60 seconds. If either fires, the transaction rolls back and the previous schema stays. The statements are idempotent (`if not exists`, `on conflict do nothing`), so a rerun after an interrupted attempt is safe.

The app roles do not run this DDL. `fomo_shadow` is not granted general DDL. The migration role is separate, and it is not applied by this repository.

A startup that waits on the migration can itself open a gap. The ordinary recovery limit is about 600 slots, roughly two minutes. A long startup is an unrecovered gap until the wide path is explicitly enabled. Enabling the flag is a later step. It is not part of applying the schema.

Tables and columns stay on rollback. Do not drop them to undo the feature.

## What the enabled path does

With the flag unset, a gap wider than about 600 slots is still recorded as unrecovered. The Helius scan is still skipped for that gap.

With the flag set, the ingestor pages `getSignaturesForAddress` on the public RPC, then fetches each transaction, decodes it, and stores it through the same backfill pipeline as a narrow gap. `received_at` is the time it was stored. The block time is not treated as a moment a live follower could have bought. A finished page walk is only a scan. `recovery_completed_at` is set only after every transaction in the gap has been stored. An empty or truncated page, or a failed fetch, decode, or persist, leaves the gap incomplete. A restart continues from signatures already stored and does not insert a second economic event.

## Turning it on

1. Let the schema migration finish first, with the flag still unset.
2. Confirm the public Solana RPC is acceptable. This path does not call Helius.
3. Set `INGEST_WIDE_RECOVERY=true`.
4. Restart only the ingestor. Leave the screener, the alerter, the outcome worker, and the shadow runner stopped.
5. Watch `ingest_recovery_checkpoint`. A row can show the scan finished while `recovery_completed_at` is still null. That gap is not recovered yet.

## Rollback

1. Unset `INGEST_WIDE_RECOVERY`, or set it to anything other than `true`.
2. Restart the ingestor. Wider gaps are unrecovered again.
3. Leave the new tables and columns in place. Do not delete `raw_events`. Do not delete checkpoint rows to hide a gap.
