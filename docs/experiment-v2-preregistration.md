# Experiment v2 pre-registration

Status: **reviewer defaults adopted, not frozen.** The owner said to follow the reviewer's answers. This file records those answers as the protocol. It is not a scored window until it is frozen with a commit hash and a date. The 79 voided paper positions are development evidence only.

A shadow period can record coverage, scheduling, and quote availability. Shadow returns are not an acceptance test and do not count toward the scored result. If shadow returns are used to change the design, that shadow is development data.

No new paid service is authorized by this document. The $150 figure is a proposed cap and still needs the owner's approval before any new spend.

## The one question

Among comparable screened coins in freshly graduated pools, available at the same time, does a frozen wallet signal improve a follower's mean return on allocated cash after the real decision delay and executable costs?

One stage. One fixed notional. One exit policy. One enrollment per mint. One validated venue is enough. A venue is included only after its ingestion and pricing have been checked, not because it looked profitable. Which venue passes that bar is **not known**.

## Adopted defaults

| Choice            | Adopted default                                                                                                                                                                                                                 | Status                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Stage             | Freshly graduated pools. Enrollment is the first 30 minutes after verified graduation. The entry delay is extra and may fall outside that window.                                                                               | Adopted                                                                        |
| Venue             | One validated venue if that is all that is validated.                                                                                                                                                                           | Adopted. Which venue is **not known**                                          |
| Exit              | Fixed 60 minutes after the actual hypothetical entry. No stop. No take-profit.                                                                                                                                                  | Adopted                                                                        |
| Notional          | $20 total entry cash, fees included, every arm.                                                                                                                                                                                 | Adopted                                                                        |
| Round-trip cap    | 10% all-in, including FOMO fees and token taxes, on contemporaneous quotes, exit quote for the acquired quantity. If nothing qualifies, that is a finding. The cap is not raised.                                               | Adopted. Not independently validated                                           |
| Fee scenarios     | Three reports. Primary stress is the higher "other routes" schedule (0.50%, $0.95 minimum) on both arms. Also report both-lowest, and adverse (wallet high, control lowest). The route actually charged is still **not known**. | Adopted                                                                        |
| Controls          | 1:1 screened controls from the same contemporaneous stratum, plus a separate pre-screen benchmark.                                                                                                                              | Adopted                                                                        |
| Minimum advantage | +5 percentage points on the matched difference.                                                                                                                                                                                 | Adopted                                                                        |
| Scored window     | 60 calendar days of enrollment, then finish outcomes already scheduled. No early stop for success. No extension.                                                                                                                | Adopted                                                                        |
| Research budget   | $150 maximum attributable hosting, data, and API cost across shadow and scoring.                                                                                                                                                | **Proposal. Needs owner approval.** No new paid service without a separate yes |
| Wallet list       | Frozen exploratory activity/graduation-selected cohort. Not "successful wallets". Not re-ranked from the 35 priced trades.                                                                                                      | Adopted                                                                        |

## What is parked

Second wave, auto-buy, signing, Flap trading, and X/social are not part of this experiment. Scale-out and a larger size for graduated coins are not part of this comparison. Partial exits are not part of this comparison.

## Enrollment timeline

Times below are an example. The rule is the same for every coin.

1. A pool's graduation is verified at 12:00:00. That clock starts the 30-minute enrollment window, which ends at 12:30:00.
2. A qualifying wallet purchase is a quantity net-buy observed before enrollment, with the observation falling inside the 60 minutes before enrollment. The purchase itself may have happened before graduation. A purchase observed only after enrollment does not count.
3. Signal time is the first moment the decision was possible with information actually in hand. In the example the graduation notice and the earlier wallet buy are both in hand at 12:02:00. Signal time is 12:02:00, not the chain time of the buy.
4. Enrollment freezes at signal time, 12:02:00, before the delayed entry. The mint, arm, stratum, and decision-time facts are fixed then. They are not rewritten when the entry quote arrives.
5. Target entry is signal time plus 180 seconds: 12:05:00, with a fresh quote. The entry may sit after the 30-minute window. Both the enrollment time and the entry time are kept.
6. If the entry quote misses the 10% cap, or no quote is available, the row stays enrolled as an unfilled opportunity. Another coin is not substituted.
7. One mint is enrolled once. A later stage of the same mint is not a new trial. The stage is not switched during the 60-day window. If few coins qualify, that is a feasibility result, not a reason to change stage.

## Exit deadline

The exit is scheduled 60 minutes after the actual hypothetical entry, not after the signal.

Diagnostic sell quotes at 15, 30, and 45 minutes are recorded and do not choose the exit.

The exit quote is the first valid observation at or after the deadline, and no later than 3 minutes after the deadline. The actual hold time is the time from entry to that observation.

An observation after the 3-minute limit is a recovery diagnostic. It is labeled late. It does not become the 60-minute exit price. The exit stays unresolved.

There is no stop and no take-profit. A paper loss may be the whole allocated cash. The −25% stop from the older paper path is not this protocol.

## Cash-flow definition

Allocated cash is $20 for every enrolled opportunity, wallet or control.

The entry fee is taken out of that $20. On the higher schedule the minimum fee is $0.95, so about $19.05 remains to buy tokens. On a flat price the exit pays another $0.95, leaving $18.10. The return on allocated cash is `18.10 / 20 - 1 = -9.5%`. That is the primary stress case before any price move. The lowest-fee schedule is reported beside it. It is not treated as the known cost.

Return is on allocated cash, not on the token proceeds alone:

- Unfilled entry: cash is unchanged. Return is 0.
- Filled entry with a valid exit: `(exit cash − 20) / 20`.
- Unresolved exit: the return is missing. It is not 0 and it is not −100%.

Token quantity and the exit quote are recomputed for each fee scenario on the same $20. Size is not increased to make the $0.95 minimum a smaller percentage.

Jupiter `outAmount` already includes pool fees. Those fees are not subtracted again.

## Groups and matching

- **Wallet arm.** Screened, inside the graduation window, with a qualifying net buyer from the frozen list.
- **Screened control.** One control per wallet opportunity, drawn at random from screened coins in the same stratum at that decision: same venue, same liquidity band, same minutes-since-graduation band, same UTC hour. Facts used are facts known then. A later graduation, later liquidity, or a later wallet buy is not used. A control is never removed and never replaced.
- **Fallback, in this order, when the stratum is empty.** Drop the hour. Then drop the age band. Then drop the liquidity band. Then the same venue only. If that is still empty, the wallet row is recorded as unmatched. It is not paired with a coin from outside the venue, and it is not given a second control later.
- **Dispatch.** Inside a matched set the quote jobs are ordered by a hash of mint and time, so the wallet is not always quoted first.
- **Pre-screen benchmark.** A separate draw, same count, from coins at the same stage and time before the predictive screen. It has its own quote budget. It is not the matched control. The ratio is 1:1. A 3:1 control ratio is allowed only if the shadow shows quote headroom at the peak, and only if that choice is written down before the scored window is frozen. It is not changed after seeing returns.
- **Screen-failed coins.** Recorded with the reason. Not a scored arm.

Capacity is the peak number of quotes due in the same 3 minutes, including both fee scenarios' extra quotes and retries. The working limit used for planning is 10 quotes per 3 minutes.

## Primary result

The primary number is the mean of paired differences, `mean(R_wallet − R_matched control)`, using raw arithmetic returns on allocated cash. No winsorizing.

Unfilled opportunities contribute 0 and stay in the count. An unresolved exit stays in the denominator and is not entered as a measured 0. Filled-trade returns are reported separately and are not the primary number.

The pre-screen benchmark is a second comparison. Beating it while the wallet arm loses money, after the required return below, is not a reason to trade.

### Worked example

Two enrolled wallet opportunities and their controls. Allocated cash is $20.

| Pair | Wallet                                                                                    | Control                                                               | Difference            |
| ---- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| 1    | Unfilled. The entry quote was over the cap. Cash unchanged. R = 0                         | Filled. Flat price, higher fee schedule. Exit cash $18.10. R = −0.095 | 0 − (−0.095) = +0.095 |
| 2    | Filled, but the exit quote never arrived inside the deadline plus 3 minutes. R is missing | Filled. R = +0.10                                                     | Missing. Not 0 − 0.10 |

The primary mean divides by both enrolled pairs: `0.095 / 2 = 0.0475`. Pair 2 is in that count. Its difference is not a measured 0. The filled-only mean, which drops pair 2, is 0.095. If that choice would change the decision, the result is inconclusive. The filled-trade report mentions the control in pair 2 and does not mention the unfilled wallet as a filled trade.

## Fee scenarios and the decision

Report the same pairs three ways:

- Both arms on the higher schedule. This is the primary stress test. It is not a statement that this route was charged.
- Both arms on the lowest-fee schedule.
- Adverse assignment: wallet on the higher schedule, control on the lowest-fee schedule.

Go has to survive the adverse assignment, or the route has to be replaced by evidence from confirmation screens. Those screens are not in hand. A Jupiter-only shadow cannot show which FOMO route or fill would have happened.

## Decisions

Uncertainty is a 95% interval from a block bootstrap. Matched pairs stay together. Days, or consecutive days, are the blocks. A bootstrap that treats each pair as independent is not the interval. There is no rule of the form "N trades is enough".

- **Go.** The lower end of the interval is above +5 percentage points, the wallet arm's own mean return is positive after recurring overhead, the shadow gates passed, and the call survives the fee scenarios and the missing-data sensitivity. Recurring overhead as a return is `recurring operating cost / executed cash allocated`, measured from the shadow. Go means a next validation stage, not live trading.
- **No-go.** The upper end of the interval is below +5 percentage points, or absolute profitability is ruled out, or execution or risk economics fail the gates.
- **Inconclusive.** Anything else. An operations failure or hitting the budget stops enrollment. That stop is not a statistical failure. Outcomes already scheduled are still collected. The budget is not increased, and the window is not extended, after seeing returns.

Fragility is reported, not used as a veto: how much of the result sits in one day or in one trade.

The older power table (about 15 points at 63 trades per group if the spread is 30 points) still says a 5-point edge is hard to see at low volume. Low volume is a feasibility result.

## Shadow

Seven complete consecutive days after the wallet lookback has coverage. It may run to 14 days. If it fails, enrollment pauses for a redesign. Shadow acceptance does not look at strategy-versus-control returns.

Pass criteria:

- **Isolation.** No trades, no Telegram, no auto-enable, no unintended production writes, including across a restart.
- **Feed.** Observed recall at least 99% against an independent reference for each included venue, in windows across the week, at least 300 reference events per venue, with the uncertainty of that rate recorded.
- **Gaps.** Every gap recorded. Eligibility withheld when history is incomplete. A staging replay of a 30-minute outage and a multi-hour outage does not create a duplicate enrollment or a retroactive signal. Recovery past about 600 slots on the live ingestor is **not built**.
- **Decisions.** Frozen membership and decision-time facts can be reconstructed. Fixture checks and a manual sample show no wrong mint, side, or quantity.
- **Scheduler.** At least 99% of attempts dispatched within 60 seconds of the target. No silent drops. Late quotes labeled late. The 3-minute exit limit enforced.
- **Capacity.** At least 30% request headroom at the observed peak, including fee scenarios and retries. A burst replay meets the deadlines.
- **Missing data.** Technical unresolved endpoints at most 2% per arm. A real trading failure stays an outcome. The missing-data sensitivity is still required.
- **Recruitment.** At least 20 complete matched records, and a credible projection of about 3 or more qualified wallet opportunities per day.
- **Economics.** Cash accounting reconciles. Both fee scenarios and the cap behave as written. FOMO preview observations say what is known and what is not known.

Pump public-RPC recall exists and is not on a timer. Independent recall for other venues is not built. Until those checks exist, no venue is validated and the shadow cannot pass the feed criterion.

## What has to be true before the clock starts

- This document is frozen: commit hash, date, and the owner's yes on the $150 proposal if any new spend is involved.
- The deployment cannot start the screener, the alerter, or alerts unless the enable flag is set.
- Collection cannot create a trade intent or send an alert.
- Decision-time facts are stored and not rewritten.
- Coverage periods are defined before returns are looked at. A bad period is not deleted after the fact.
