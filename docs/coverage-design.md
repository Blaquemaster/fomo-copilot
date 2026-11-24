# Coverage design

This is a design. The live backfill still stops at about 600 slots. Recovering a longer outage is **not built**. Turning it on would change the live ingestor and needs its own rollout.

## What a healthy period is

A period is healthy for a venue only when all of these are true, and the decision is written down before anyone looks at returns:

- The ingestor was running.
- No unrecovered row in `phasec_gap_period` overlaps the period.
- The venue's last event was inside the staleness window.
- An independent recall for that venue, using a provider other than the one that fed the stream, was run and its misses were recorded.

A period that fails any of those is unhealthy. It is not deleted after the returns are known. Scored entries inside it stay in the record and are flagged.

## Provenance

Live rows already store `received_at` and, when the chain gives it, the block time. Recovered rows on the telemetry branch are `source='backfill'`. A recovered purchase must not be treated as something a live follower could have bought at the block time. The first time we stored it is `received_at`. A separate recovery-completed timestamp is **not built**.

## Independent recall

Pump.fun has a public-RPC check (`recallPumpFromPublicRpc`). It is not on a timer. The same shape is required before a venue is included in the scored experiment:

| Venue                | Independent check                           | Status               |
| -------------------- | ------------------------------------------- | -------------------- |
| Pump.fun             | Public Solana RPC `getSignaturesForAddress` | Built, not scheduled |
| PumpSwap             | Same RPC, PumpSwap program                  | **Not built**        |
| LaunchLab            | Same RPC, LaunchLab program                 | **Not built**        |
| Meteora DBC and DAMM | Same RPC, those programs                    | **Not built**        |
| Flap / BSC           | Not a scored venue                          | Parked               |

## Recovery beyond 600 slots

Not built. A later change would page a public or parsed history in chunks, record each chunk's slot range and whether it finished, and stop at a credit cap. Until that exists, any outage longer than about two minutes is an unhealthy period for the venues that give up at 600 slots.
