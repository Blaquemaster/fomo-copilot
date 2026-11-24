# Wide recovery rollout and rollback

This change touches the ingestor. Do not merge it until the owner asks. Merging does not turn the wider backfill on. `INGEST_WIDE_RECOVERY` must be the exact word `true`, and it is unset.

## What a deploy would do

The next ingestor start runs migration `028_wide_recovery`. That adds `ingest_recovery_checkpoint` and a nullable `recovery_completed_at` on `ingest_backfill`. Existing rows stay as they are. With the flag unset, a gap wider than about 600 slots is still recorded as unrecovered, and the Helius scan is still skipped for that gap. No new `raw_events` rows are written by this path.

## Turning it on

1. Confirm the public Solana RPC is acceptable for a page walk. This path does not call Helius.
2. Set `INGEST_WIDE_RECOVERY=true` in the deploy environment.
3. Restart only the ingestor. Leave the screener, the alerter, and the outcome worker stopped.
4. Watch `ingest_recovery_checkpoint`. A finished walk has `recovery_completed_at` set. An unfinished walk leaves the gap unrecovered.

The walk records signatures it saw. It does not insert those signatures into `raw_events`, so a recovered purchase is not treated as something a live follower could have bought.

## Rollback

1. Unset `INGEST_WIDE_RECOVERY`, or set it to anything other than `true`.
2. Restart the ingestor. Wider gaps go back to the unrecovered record.
3. Leave the new table and the new column in place. Do not delete `raw_events`. Do not delete checkpoint rows to hide a gap.
