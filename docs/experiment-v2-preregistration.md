# Experiment v2 pre-registration

Status: **draft, not frozen.** Nothing here is approved. The 79 voided paper positions are development evidence only and are not a result. This document is the thing that gets frozen, with a commit hash and a date, before any scored window starts.

A shadow period can record coverage and quote availability. It does not count toward the scored result.

## The one question

Among comparable screened trench candidates that are available at the same time, does a frozen wallet signal improve a follower's mean net return after the real decision delay and executable costs?

One stage. One fixed notional. One exit policy. One enrollment per mint. Venues are chosen because their ingestion and pricing have been checked, not because they looked profitable.

## What is parked

Second wave, auto-buy, signing, Flap trading, and X/social are not part of this experiment. Scale-out and a larger size for graduated coins are not part of the first scored comparison. The wallet list is an exploratory activity/graduation-selected cohort, not a list of successful wallets. It is not re-ranked from the 35 priced trades.

## Open choices

These are the owner's. Recommended defaults are not a freeze.

| Choice                       | Recommended default                                                                                                                                                      | Status   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Fee route                    | Do not assume a route. Report both the lowest-fee schedule and the other-route schedule ($0.95 minimum). The route stays unknown until confirmation screens are checked. | **OPEN** |
| Venue                        | Include a venue only after its ingestion and an independent recall check are accepted. Which venue passes that bar is not known.                                         | **OPEN** |
| Stage                        | Trench only.                                                                                                                                                             | **OPEN** |
| Fixed notional               | One dollar amount for every arm. $5 matches the old trench cap, and it may be too small if the $0.95 minimum applies. Do not raise the size to dilute that minimum.      | **OPEN** |
| Entry and round-trip cap     | Neither 5% nor 10% is validated. Freeze one number before the window and do not relax it to get more trades. The 1% of pool liquidity cap is secondary.                  | **OPEN** |
| Minimum worthwhile advantage | The smallest mean-return gap that would be worth a next validation stage. A suggested reading of the power table is 15 points, which this sample can barely see.         | **OPEN** |
| Scored window and stop date  | A fixed calendar window, set before the first scored entry. No peeking at the primary result during the window.                                                          | **OPEN** |
| Research budget              | Maximum scored entries, and a separate note of hosting and data cost. The budget is not increased after seeing returns.                                                  | **OPEN** |

## Groups

All groups use the same hypothetical entry and the same scheduled exit quotes.

- **Wallet arm.** A screened candidate with at least one qualifying buyer from the frozen list.
- **Screened no-wallet control.** Drawn at random from the screened candidates that are eligible at that same decision, with no tracked buyer yet. Stratified on facts known then: token age, venue, liquidity range, and time of day. The draw is random, not mint-sorted. A control is not removed if a tracked wallet buys the coin later. Matching does not use a future graduation or later liquidity.
- **Pre-screen random benchmark.** Drawn at random from coins at the same stage and time before the predictive screen is applied. This asks whether the screen plus the wallet beats a coin we did not screen.
- **Screen-failed coins.** Diagnostic only. They are recorded with the failure reason. They are not a scored arm.

One mint is enrolled once. A later stage of the same mint is not a new trial.

## Primary result

Mean net return per trade, after the executable round trip and the fee schedules above.

The comparison is wallet arm minus screened no-wallet control, at the same notional.

Secondary descriptions, not vetoes: median, win rate, tail losses, drawdown, and how much of the result sits in the single best trade. A positive median and "still profitable without the best trade" are fragility notes. They are not required for a decision.

Beating the benchmark while the wallet arm loses money is not a reason to trade.

Unresolved outcomes stay in the denominator. If a different treatment of missing data would change the decision, the result is inconclusive.

## Decisions

- **Go.** The pre-registered uncertainty interval for the wallet-minus-control mean lies entirely above the frozen minimum advantage, the wallet arm's own costs are understood well enough that the route assumption is no longer open, and missingness does not flip the call. Go means a next validation stage, not live trading.
- **No-go.** The interval lies entirely below zero, or the wallet arm loses money after the frozen costs and does not beat the pre-screen benchmark.
- **Inconclusive.** Anything else, including a window that misses the frozen budget, a route that is still unknown, or a missing-data choice that changes the call.

## Uncertainty and power

The uncertainty is a block over time, and a mint cannot appear twice. A bootstrap that treats every row as independent is not the primary interval.

Power is approximate, two-sided 5%, for a difference in means. It is not a promise.

| Trades per group   | Detectable gap if the spread is 30 points | Detectable gap if the spread is 50 points |
| ------------------ | ----------------------------------------- | ----------------------------------------- |
| 63                 | about 15 points                           | about 25 points                           |
| 168                | about 9 points                            | about 15 points                           |
| about 565 to 1,568 | about 5 points                            | about 5 points                            |

A 5-point edge is not detectable at the volume seen so far. Inconclusive is the expected call unless the edge is large.

## Exit policy

One policy for every arm: a fixed horizon, with the same scheduled executable sell quotes along the way. The −25% stop is an attempt to get out, not a cap on the loss. The 3% daily pause stops new portfolio entries only. It does not cap losses already open, and it does not stop the opportunity record.

Opportunity records (every qualifying signal and control) are separate from the portfolio simulation (bankroll, concurrency, hourly cap, quiet hours, pause). Each portfolio arm, if simulated, has the same bankroll and the same risk rules.

## What has to be true before the clock starts

- This document is frozen: commit hash, date, and every OPEN row filled.
- The deployment cannot start the screener, the alerter, or alerts unless the enable flag is set.
- Collection, when it is turned on, cannot create a trade intent.
- Decision-time facts are stored and not rewritten.
- Coverage periods are defined before returns are looked at. A bad period is not deleted after the fact.
