# FOMO Trading Copilot master specification

Version: 2026-11-28.2

This is the completion inventory. It is not a deployment, a diagnostic launch, or a claim that any feature has been validated. Production `main` is `6555907ee2a0cdf45a6b5cc7dafe92790d833a6b`. The held release branch is `cursor/release-main-8ff7` in pull request #60. Nothing in this document authorizes a merge, a publish, a server change, alerts, paper trading, signing keys, `AUTOBUY_LIVE_CONFIRMED`, or a new paid service.

Two labels are used and they are not interchangeable.

- **Build-complete** means the feature is implemented, connected to its entrypoints, storage, permissions, and reporting, and its later acceptance procedure is written. It does not mean the data are good or that the feature makes money.
- **Validated** means that completed implementation has later passed its acceptance procedure. No row in the matrix is validated.

A feature may be build-complete and still disabled. A flag that is off does not make an unimplemented feature complete. An unknown future observation, such as the fee route on a particular order, does not block building a collector for that observation.

Solana is the product boundary stated on 28 November 2026. Additional chains do not enter by assumption.

## Settled dispositions

Arvin settled these on 28 November 2026. The build rule is to choose what makes the finished system complete. None of these are awaiting a decision.

| Capability | Disposition |
| --- | --- |
| Trench, near graduation, post graduation, second wave, and scale-out | Included. Each stage needs a config, a precedence order, and a data-readiness result. Second wave is secondary to the frozen primary comparison. |
| X / social | Included as a bounded, mint-linked collector. Fixtures are for development. Missing or stale data is `unknown`. No X API is subscribed. |
| Creator analysis | Included: holdings, sales, previous launches, and evidenced relationships. A shared funder is not common control. |
| Trade and liquidity history | Included as 30 days of observed 1-minute aggregates for the admitted universe, with explicit gaps. Not a full chain. |
| Automatic execution | Included for entry and exit on the Jupiter order, sign, and execute path. Production keys, funding, and real orders stay off. |
| Flap and other chains | Excluded from the running Solana deployment. The parser is archived and disabled. Stored rows stay. |
| Owner view | A private authenticated web dashboard. Telegram is an optional notification channel. Alerts stay held. |
| Deploy helper | Diagnostic start, status, and stop are added. No Docker socket for the deploy account. |
| Pull request #39 | Review and copy only the changes the build needs. Do not merge it whole. |
| Pull request #41 | Adapt its grants into least-privilege roles for the whole product. Apply nothing to production. |
| Primary comparison | Frozen as D12 in the matrix. Fee scenarios use the Jupiter cost model. |

## Social collector cost

The collector is not built. No X API tier is subscribed. This repository does not contain a current X price list, so the dollar price of a paid tier is not known. A paid tier needs a later yes.

Planning volume, before any subscription:

- The admitted universe is capped at 200 mints until a measured cap replaces it.
- A live lookup for one mint runs at most every 15 minutes, and only during a 16-hour window.
- That is 200 mints times 64 lookups times 30 days = 384,000 lookups a month.
- The default live cap is 0 until a provider is approved. The fixture source stays available for development and spends nothing.
- A missing or stale lookup is stored as `unknown`. It is not a zero mention count.

## History storage and API use

The aggregate is not built. The estimate is from the settled rule, not from a measured table.

- Cadence: one row per mint per minute.
- Universe admission: a mint enters only when it is in the declared monitored set. The planning cap is 300 mints.
- Thirty days at that cap is 300 times 43,200 minutes = 12,960,000 aggregate rows.
- A minute with no observed swap is a gap. It is not a zero-volume bar.
- The rows are built from trades the Solana ingestor already stored. They are not a second full-chain scan.
- Extra RPC is only for a recorded gap. That fill is not a new paid budget. The $25 ceiling remains the diagnostic ceiling only.
- Experiment inputs and records stay for the run and at least 90 days after the run closes, then move to an archive table. They are not deleted.
- Execution ledgers, fills, creator history, configs, and audit rows are not on that 90-day clock. Their archive job is separate and is not built.

## Jupiter execution cost

The cost model is not built. When it is built it records, separately, the Jupiter platform fee, network fees, tips, token-account rent and recovery, a failed transaction's cost, pool fees, and slippage. A FOMO fee is not added to a Jupiter quote. FOMO remains available only as a manual action. Each included stage records buy coverage and sell coverage. A bonding-curve coin without a sell route is `unavailable`.

The order API for that path is Jupiter Ultra: `GET https://api.jup.ag/ultra/v1/order` and `POST https://api.jup.ag/ultra/v1/execute`. `quoteUrlAllowed` currently allows only `https://api.jup.ag/swap/v1/quote` and `https://api.jup.ag/swap/v1/swap`. The Ultra paths are not allowed yet. They are named here so the client does not invent a third host.

## 1. What the complete system includes

The fixed inventory is `docs/completion/matrix.md`. Each included row has an ID, inputs, outputs, failure behavior, and a later acceptance procedure.

Implementation scope and activation permission are separate. The screener and alerter are behind compose profiles and `serviceGate.ts`. Those gates being off does not complete the missing dashboard, the missing signer, or the missing execution route.

Definition of done for this section: one inventory, and no required feature left unnamed. The twelve scope choices are settled in version 2026-11-28.2. The inventory is no longer waiting on them. The features themselves are not build-complete.

## 2. One authoritative event and accounting record

Entrypoints that write today include the ingestor loop, the wallet job, the screener cycle, and the diagnostic runner. They write `raw_events`, ingest checkpoints, `phasec_candidate`, `phasec_alert`, `phasec_position`, `phasec_execution`, `phasec_observation`, `phasec_quote_attempt`, `phasec_quote_failure`, and `autobuy_intent`. Reports do not all read one record. Some screen facts are recomputed from queries in `packages/core/src/db/phasec.ts`.

`raw_events.received_at` is the observation time for an ingested event. Chain time and decision time are not stored as three required fields on every decision. A later backfill must not be treated as data an earlier decision could see. That rule is not implemented as one check across the tables.

`ingest_backfill.unrecovered` and `ingest_recovery_checkpoint` record gaps. Wide recovery is off on this branch. Parser version is not a column. `phasec_wallet_list_version` exists. The qualification wallet-list version and the venue are unset.

Exact token quantities, fees, partial exits, failed attempts that cost money, reserved cash, and unresolved holdings are not one ledger. Positions and dry-run intents store sizes. A correction that keeps the original row and explains the change is not built.

`apps/ingestor/src/replay.ts` replays stored ingest. It is not a replay of a decision through its financial result.

Definition of done: every included entrypoint writes the same records; reports read those records; replay and duplicate handling are implemented; a decision can be traced to its result without reconstructing it by hand. Status: partial.

## 3. Execution matches the service actually used

The selected route is Jupiter Ultra order, then sign, then execute. It is not built. `lookupTradableInFomo` returns null and does not call FOMO. A Jupiter quote is a quote. It is not a fill. FOMO is manual only. FOMO's own help states that fee routes can change between trades and that quoted prices can differ from fills. This repository does not contain that help page, and it does not invent a FOMO API.

The dry-run auto-buyer can store an intent marked simulated. `resolveAutobuyMode` refuses `live` because signing is not implemented, even when `AUTOBUY_LIVE_CONFIRMED` is `yes`. There is no submission, acknowledgement, receipt reconciliation, or final-holdings update. An uncertain submission cannot be represented, so the rule against a second automatic submission is not built.

Paper decisions and the dry-run intent share some size and pause checks in `risk.ts` and `admitAutobuy`. They are not one execution workflow.

Definition of done: the Jupiter order, sign, and execute path runs from intent through reconciliation, with every terminal and unresolved state stored. A dry-run that only stores an intent, or a live mode that only throws, is not that path. Status: not built. Tests use a test keypair or a simulation. No production key is loaded.

## 4. Wallet intelligence

`packages/core/src/ingest/wallets.ts` scores a delayed mark after a fee. The file says a graduation is not a win and a missing mark is dropped. That is not the same as three stored measures: graduation activity, the wallet's own result, and a follower entering at the system's delay and cost. The third measure is not a separate record.

Swaps, transfers, wrapped SOL, fees, and account movements are not fully classified. Unclassified activity is not given its own visible bucket. Sample size, missingness, holding period, downside, concentration in a few winners, and an insufficient-data result are not the selector's contract. Shared funding is not recorded, and it would not be proof of common control if it were.

`SCORING_VERSION` is 3. `mayApplyV3List` refuses to replace the live list while a paper test is open. `phasec_wallet_list_version` exists. No qualification cohort is frozen. The current exploratory list is not a profitability result.

Definition of done: selection reads versioned rows and can show the transactions, the coverage, and the assumptions. Missing evidence is an explicit insufficient-data result. Status: partial.

## 5. One risk engine

`packages/core/src/phasec/risk.ts` sizes from cash, liquidity, and the daily-loss pause. `screen.ts` applies holder, sniper, and creator-sell gates. Token-extension checks exist in `token2022.ts`. These are not one policy object with a version recorded on every entry path. A retry or another worker can still apply a different check. That bypass is not closed.

Recording an opportunity and admitting it to a portfolio are separate functions, and a pause does not by itself delete candidates. Reserved cash and unresolved holdings are not carried through a restart as one balance. Which failures stop new entries, which stop diagnostics, and how an open position stays managed are documented in pieces in `docs/deployment-acceptance.md` and are not one engine.

If automatic execution is later included, its spend limit and independent stop are not a reason to install a key. Signing remains absent.

Definition of done: every entry path calls the same policy and stores the decision, the reasons, and the policy version. Status: partial.

## 6. Owner-facing operating view

There is no web dashboard. The alerter accepts `/ping`, `/status`, `/events`, and `/crashtest` from an allowlisted chat. The alerter service is stopped. Those commands are not a view of feed health, decisions, wallet evidence, cash, provider usage, or release identity.

`scripts/cutover-report.sh` prints feed checkpoints, gaps, the running image, diagnostic spend, and account usage. It says `not recorded` when a value is absent. It is a host script, not an application view. Release evidence for pull request #60 is the push run `45462755214`, artifact `14953876440`, and the digest recorded in that run. A later commit needs its own evidence.

Definition of done: the owner can open connected views and exports that read the authoritative records and the running process, with empty and stale states shown as such, and with no control that turns on trading or reveals a secret. Status: not built.

## 7. Evaluation tools in the finished build

`review3.ts` contains predeclared calibration scenarios and sets `inferentialGoEnabled` to false. `paper.ts` summarizes paper returns. `apps/ingestor/src/replay.ts` replays ingest. CI covers some outage, migration, duplicate, restart, and budget cases for the ingestor and the diagnostic runner. There is no single command that runs the full scenario list against the authoritative records and writes the final report.

The distinctions among a known zero-return unfilled opportunity, a missing outcome, an evidence bound, and an assumption-based sensitivity are described in `docs/deployment-acceptance.md` and in the diagnostic spec. They are not one report generator. The primary comparison for a finished multi-strategy system is not fixed. That is decision D12.

Definition of done: the evaluation programs, scenarios, expected outcomes, commands, and report are implemented and ready to run after build completion. Their presence is not a passing result and not an edge. Status: partial.

## Release engineering from pull request #60

Pull request #60 stays open, held, and unmerged. It is the foundation for the later guarded release. Its push CI on `a7a796384c178b9c659ce9751cd4bf20dc05d339` is green. The recorded image was not pushed. The package is not public.

Included and already on that branch:

- One pull request into `main`, tree check, pin file, and the refusal of older digests.
- No push, pull request, `workflow_run`, `workflow_call`, `repository_dispatch`, or `schedule` path to deploy or publish. Ordinary CI on push remains.
- Retained OCI artifact, checksum check, and a local copy that does not rebuild.
- `fomo-deploy` is not in the `docker` group and cannot open the Docker socket. Sudo allows only `/usr/local/lib/fomo/fomo-deploy-helper`.
- Commands on that helper: `rehearse`, `backup`, `promote`, `install-rollback`, `preflight`, `report`.
- Minimum diagnostic role file `infra/sql/fomo-shadow-diagnostic.sql`. It is not applied. `infra/db/shadow-roles.sql` and pull request #41 stay unapplied.
- Forward-fix-only rollback. The diagnostic credit ceiling in the runner is 50,000 credits and $25. That ceiling is not a budget for new services.

The deploy-account permission gap remains. The account cannot start a container. The diagnostic entrypoint is still started by a root operator because the helper has no such command. CI confirmed the socket denial and confirmed that `rehearse` still targets project `fomo-copilot`, context `default`, volume `fomo-copilot_pgdata`, and the existing Postgres container when the working directory and environment are changed. Closing that gap, or accepting root for the diagnostic start, is decision D9. It is not a reason to put the account in the `docker` group.

The live Deploy workflow on `main` still has a push trigger until the owner disables it and merges #60. This document does not do either.

## Order from here

1. Close the decisions in `docs/completion/matrix.md`. This file is step 1.
2. Finish the included implementation on branches. #60 stays the release foundation.
3. Mark build completion only from the matrix.
4. Run the acceptance procedures, including failures and the deployment procedure, and correct what fails.
5. Issue new release evidence for the commit that actually ships. The digest from #60 does not cover later code.
6. Deploy only through the guarded procedure after a separate approval. The diagnostic is then a live test of the completed system. It is not the next step while required product pieces are unfinished. Qualification and scored paper wait for their own conditions. No real-money activation is included.

Existing production ingestion stays as it is while this work is held.
