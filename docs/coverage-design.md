# Coverage design

The live backfill still stops at about 600 slots. `walkSignatureGap` can page the public Solana RPC past that cap. It does not write `raw_events` and it does not call Helius. The live loop does not call it until the wide-recovery change is on and `INGEST_WIDE_RECOVERY` is exactly `true`.

## What a healthy period is

A period is healthy for a venue only when all of these are true, and the decision is written down before anyone looks at returns:

- The ingestor was running.
- No unrecovered row in `phasec_gap_period` overlaps the period.
- The venue's last event was inside the staleness window.
- An independent recall for that venue, using a provider other than the one that fed the stream, was run and its misses were recorded.

A period that fails any of those is unhealthy. It is not deleted after the returns are known. Scored entries inside it stay in the record and are flagged.

## Provenance

Live rows already store `received_at` and, when the chain gives it, the block time. Recovered rows on the telemetry branch are `source='backfill'`. A recovered purchase must not be treated as something a live follower could have bought at the block time. The first time we stored it is `received_at`. The wide-recovery checkpoint stores `recovery_completed_at` when a page walk finishes. That timestamp is not a signal that the purchase was available live.

## Independent recall

Pump.fun has a public-RPC check (`recallPumpFromPublicRpc`). It is not on a timer. The same shape is required before a venue is included in the scored experiment:

| Venue                | Independent check                           | Status               |
| -------------------- | ------------------------------------------- | -------------------- |
| Pump.fun             | Public Solana RPC `getSignaturesForAddress` | Built, not scheduled |
| PumpSwap             | Same RPC, PumpSwap program                  | Built, not scheduled |
| LaunchLab            | Same RPC, LaunchLab program                 | Built, not scheduled |
| Meteora DBC and DAMM | Same RPC, those programs                    | Built, not scheduled |
| Flap / BSC           | Not a scored venue                          | Parked               |

## Recovery beyond 600 slots

`walkSignatureGap` pages `getSignaturesForAddress` on the public RPC and stamps `recovery_completed_at` on the page that reaches the start of the gap. The live ingestor still treats a wider gap as unrecovered until that walker is switched on. Until then, an outage longer than about two minutes stays an unrecovered gap.
