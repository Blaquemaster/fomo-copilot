# Completion matrix

Version: 2026-11-28.2. Specification: `docs/completion/master-spec.md`.

Status is `not built`, `partial`, or `build-complete`. Nothing below is validated. Counts at this version: 41 rows, of which 2 are build-complete, 26 are partial, and 13 are not built. The twelve scope choices are settled. No row is awaiting a decision. The two build-complete rows are the release route and the trigger check on pull request #60. They have not been executed on production.

Locations are on `cursor/release-main-8ff7` unless a row says otherwise. Closed pull requests #1 through #38 and #40 and #42 through #59 are ancestors of #60 or older `main` work already contained in it, except where a row names a branch that is not. Pull request #39 is not an ancestor of #60. Pull request #41 is not an ancestor of #60.

## Settled scope

Settled by Arvin on 28 November 2026. The build rule is to make the best decision for the build. These are included or excluded. None are awaiting a decision. They are not a request to launch the diagnostic or to change production.

| ID  | Settled choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Included: trench, near graduation, post graduation, and second wave, plus every exit policy including scale-out. Each stage has an explicit config, a precedence order, and a data-readiness rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | Included: a bounded live collector that links posts to a mint, behind a provider budget gate. Fixtures are for development. Missing or stale social data is `unknown`. No X API tier is subscribed or paid. A paid provider is an activation that needs a later yes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | Included: a creator module for holdings, sales, previous launches, and evidenced wallet relationships. A shared funder is not proof of common control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D4  | Included: 30-day rolling observed swap and liquidity history for the declared monitored universe, as 1-minute aggregates with explicit gaps. This is not a full-chain archive. Experiment inputs and records are kept through the run and at least 90 days after closure, then archived rather than discarded. Execution ledgers, fills, creator history, configs, and audit rows have their own archival policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D5  | Included: Jupiter's order, sign, then execute API is the primary execution path. Copilot controls eligibility, size, and risk. The trading wallet is dedicated and limited-funded. FOMO is optional manual trading only, because FOMO terms restrict automation. Every included stage records whether a buy route and a sell route exist. An unsupported route is `unavailable`. The cost model uses Jupiter platform fee, network fees, tips, token-account rent and recovery, failed transactions, pool fees, and slippage. It does not apply FOMO fees to a Jupiter quote.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D6  | Included: automatic entry and automatic exit. Fresh facts and a quote are checked, and spend, liquidity, slippage, and all-in cost limits are applied, immediately before signing. An exit that does not liquidate stays an explicit unresolved state. Funds are reserved. A second worker or a restart cannot duplicate an order. An uncertain transaction is resolved before any replacement. A timeout is not another buy. Submission is not confirmation. The signer is isolated and checks the transaction's contents, destinations, amounts, and allowed programs. Exposure and spend limits are enforced outside the strategy process. New entries and all signing have separate kill switches. An entry pause still allows exits. Execution is event-driven, and latency is measured. A dry-run intent row, or a live mode that only throws, is not complete. Hold: no production key, no wallet funding, no `AUTOBUY_LIVE_CONFIRMED`, and no real order. After any deploy, `AUTOBUY_MODE` is `dry_run`. Tests use a test keypair, devnet, or a simulation. |
| D7  | Excluded from the Solana deployment: the Flap and BNB parser is archived and disabled. Existing rows stay. The product is Solana only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D8  | Included: a private authenticated web dashboard is the owner view. It shows every operating view in the specification, reads the authoritative records, and shows empty, stale, and unavailable on purpose. It does not show secrets. Telegram remains an optional notification channel. Alerts stay held.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D9  | Included: the root-owned helper gains diagnostic start, status, and stop. The deploy account stays out of the `docker` group and does not receive the Docker socket.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D10 | Included as a review, not a merge: pull request #39 is read and only the changes the build needs are copied. It is not merged as a whole.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D11 | Included: least-privilege roles for ingest, screening, execution records, the signer, reporting, and admin. Pull request #41 is adapted after its grants are reviewed. Nothing is applied to production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D12 | Included and frozen: the primary comparison is freshly graduated pools, one qualified venue path, a frozen wallet cohort against contemporaneous screened controls with no wallet, $20 total cash, a 180-second entry delay with a stated deadline, and a fixed 60-minute exit. The primary comparison does not use scale-out, a stop, a take-profit, or social data. A worthwhile advantage is 5 percentage points. The endpoint is 60 days. Fee scenarios share one enrolled population. Missing outcomes stay explicit. Absolute economics and risk are required. Inference stays off until a later validation. Other strategies are secondary. Fee scenarios use the Jupiter route, not a FOMO fee on a Jupiter quote.                                                                                                                                                                                                                                                                                                                                          |

## Matrix

### SPEC-001. One versioned inventory

- Requirement: one specification with IDs, inputs, outputs, dependencies, failure behavior, and completion criteria, and no required feature hidden behind the word complete.
- Status: partial.
- What exists: this file and `docs/completion/master-spec.md` on this branch.
- Remaining work: close D1 through D12. Until then the inventory is not fixed.
- Dependency: none.
- Implementation location: `docs/completion/`.
- Later acceptance: an owner reads the decision table and every disposition is included, excluded by Arvin, or explicitly still open. No open decision is described as complete.

### SPEC-002. Disabled is not the same as unfinished

- Requirement: a feature can be built and held off. A missing feature is not complete because its flag is off.
- Status: partial.
- What exists: `packages/core/src/runtime/serviceGate.ts` and compose profiles keep screener, alerter, outcomes, and shadow from starting unless the flag is the word `true`.
- Remaining work: apply the same distinction to execution, the dashboard, and every parked capability after D1 through D8.
- Dependency: D1, D5, D6, D8.
- Implementation location: `serviceGate.ts`, `infra/docker-compose.yml`.
- Later acceptance: for each included feature, the matrix shows either build-complete and disabled, or not built. A disabled flag alone is not accepted as build-complete.

### ING-001. Solana venue intake

- Requirement: ingest Pump, LaunchLab, and Meteora events with checkpoints and decode failures.
- Status: partial.
- What exists: `apps/ingestor/src/loop.ts`, `packages/core/src/ingest/decode.ts`, tables `raw_events`, `ingest_coin`, `pump_coin`, `pump_trade`. Introduced across closed pull requests #18 through #22 and contained in #60.
- Remaining work: production `main` does not contain this branch. Wide recovery is off, so a gap while ingest is down stays unrecovered.
- Dependency: none for Solana. D7 forbids treating Flap as part of this row.
- Implementation location: `apps/ingestor`, `packages/core/src/ingest`, `packages/core/src/db/ingest.ts`.
- Later acceptance: a fixture replay and a read-only production comparison show the same program ids, and an induced gap remains `unrecovered` while wide recovery is off.

### ING-002. Times, provenance, parser version, wallet-list version, run identity

- Requirement: store chain time, observation time, and decision time separately. Store provenance, recovery status, parser version, wallet-list version, and run identity. A later backfill must not look as if an earlier decision could see it.
- Status: partial.
- What exists: `raw_events.received_at`, `ingest_backfill.unrecovered`, `ingest_recovery_checkpoint`, `phasec_wallet_list_version`, and run-identity migration `031_run_identity` in `ingest.ts`.
- Remaining work: parser version is not stored. The three times are not required on every decision. The backfill-visibility rule is not one check.
- Dependency: ACC-001.
- Implementation location: `packages/core/src/db/ingest.ts`.
- Later acceptance: a replay inserts a late event and the earlier decision row still shows that the event was absent at decision time.

### ING-003. Flap parser

- Requirement: do not add a chain by assumption. Record the existing parser.
- Status: partial.
- What exists: `packages/core/src/ingest/flap.ts`, `apps/ingestor/src/bsc.ts`, migration `015_bsc_flap`. Closed pull requests #23 and #24, contained in #60. Flap trading is not built.
- Remaining work: the Solana deployment must not open the BSC socket. The parser and stored rows stay.
- Dependency: none. D7 is settled.
- Implementation location: `apps/ingestor/src/bsc.ts`, `apps/ingestor/src/main.ts`.
- Later acceptance: with the Solana flag at its default, the process starts no BSC socket. Existing `ingest_chain_event` rows are still readable.

### WAL-001. Three wallet measures

- Requirement: keep graduation activity, the wallet's own result, and a follower at the system's delay and cost as separate measures.
- Status: partial.
- What exists: `packages/core/src/ingest/wallets.ts` says a graduation is not a win and scores a delayed mark after a fee. `wallet_fill` stores fill amounts. Pull requests #25, #28, #29, and #47 are in #60.
- Remaining work: the follower measure is not its own record. Insufficient data is dropped in the scorer rather than stored as an insufficient-data result.
- Dependency: D4, ACC-001.
- Implementation location: `packages/core/src/ingest/wallets.ts`.
- Later acceptance: one fixture wallet produces three stored results, and a missing exit is visible as insufficient data.

### WAL-002. Activity classification

- Requirement: classify swaps, transfers, wrapped SOL, fees, and account movements. Leave unclassified rows visible.
- Status: not built.
- What exists: trade names used by the wallet job. No classifier with an unclassified bucket.
- Remaining work: the classifier and the stored bucket.
- Dependency: D4.
- Implementation location: not built. The wallet job is `apps/ingestor/src/walletJob.ts`.
- Later acceptance: a fixture with one of each movement stores five classes plus any row that matched none.

### WAL-003. Evidence, concentration, and shared funding

- Requirement: report sample size, missingness, holding period, downside, and concentration in exceptional winners. Record shared funding without treating it as common control.
- Status: not built.
- What exists: paper and review summaries compute some return statistics. They are not this wallet report. Shared funding is not stored.
- Remaining work: the report and the funding rows.
- Dependency: WAL-001.
- Implementation location: not built.
- Later acceptance: a wallet with one large winner shows the concentration, and a shared funder does not by itself merge two wallets.

### WAL-004. Frozen cohort

- Requirement: use only information available before the decision. Do not replace the cohort during a frozen experiment.
- Status: partial.
- What exists: `SCORING_VERSION` is 3. `mayApplyV3List` refuses a replacement while paper is open. `phasec_wallet_list_version` exists. The qualification version is unset.
- Remaining work: a frozen version id and a check that a decision cannot read a later list.
- Dependency: D12.
- Implementation location: `packages/core/src/ingest/wallets.ts`.
- Later acceptance: two list versions exist, and a decision row names the earlier one.

### SCR-001. Token screen

- Requirement: screen liquidity, price impact, holders, snipers, creator sells, and token extensions, with an explicit unknown state.
- Status: partial.
- What exists: `packages/core/src/phasec/screen.ts`, `token2022.ts`, `apps/screener/src/holders.test.ts`. Pull requests #36 through #38 are on `main`'s history. Pull request #39 changes this screen and is not in #60.
- Remaining work: unknown denominators are not one contract. D10 decides whether #39 is reused.
- Dependency: D3, D10.
- Implementation location: `packages/core/src/phasec/screen.ts`.
- Later acceptance: a coin with a missing holder count is stored as unknown and is not given a passing number.

### SCR-002. Record opportunity separately from admission

- Requirement: a pause must not delete a qualifying opportunity or a control observation.
- Status: partial.
- What exists: `phasec_candidate` and `entryDecision` in `risk.ts`. Candidates are not the same table as positions.
- Remaining work: a test that a pause leaves both the candidate and the control row in place. Not known to exist as one test.
- Dependency: ACC-001.
- Implementation location: `packages/core/src/phasec/risk.ts`, `packages/core/src/db/phasec.ts`.
- Later acceptance: after a forced pause, the candidate count and the control count are unchanged.

### STR-001. Strategy stages and scale-out

- Requirement: implement only the stages and exit treatments D1 includes, and keep the others disabled without calling them complete.
- Status: partial.
- What exists: stages and arms in `protocol.ts` and `score.ts`. Scale-out accounting exists and `scaleOutEnabled` is off. Second wave labeling is `secondWave.ts`. Closed pull requests #30, #40, and #51 are in #60.
- Remaining work: explicit config, precedence, and a data-readiness result for all four stages and for scale-out. An unready stage is `unavailable`, not a silent skip.
- Dependency: RDY-001.
- Implementation location: `packages/core/src/phasec/`.
- Later acceptance: an excluded stage cannot open a position, and an included stage writes a decision with the policy version.

### EXE-001. Selected execution workflow

- Requirement: implement the chosen route from intended spend through quote, eligibility, submission or manual handoff, acknowledgement, status, receipt, and holdings.
- Status: not built.
- What exists: Jupiter quote collection and a dry-run intent. `JUPITER_SWAP_URL` is named in `autobuy/run.ts`. No order is submitted. Closed pull request #35 is in #60.
- Remaining work: the Jupiter order, sign, and execute path, route coverage per stage, the cost model, reservation, duplicate prevention, and the isolated signer. Tests use a test keypair or a simulation. No production key and no real order.
- Dependency: ACC-001, RSK-001.
- Implementation location: `packages/core/src/autobuy/run.ts`, `packages/core/src/phasec/fomoLookup.ts`.
- Later acceptance: each terminal and unresolved state has a stored row. A second automatic submission does not follow an uncertain first submission.

### EXE-002. Quoted, simulated, and actual stay distinct

- Requirement: label quotes, simulations, and fills separately. Store assumed fees and observed charges separately.
- Status: partial.
- What exists: `autobuy_intent.simulated` and a fee schedule on the phase C config (`solana_lowest_fee`, `solana_other`, `fixed_usd`).
- Remaining work: observed charges and actual fills. A quote must not be stored as a FOMO result.
- Dependency: D5.
- Implementation location: `packages/core/src/phasec/protocol.ts`, `packages/core/src/db/ingest.ts` table `autobuy_intent`.
- Later acceptance: one opportunity can show a quote, a simulated intent, and no fill, and the report does not add them together.

### ACC-001. One record from event to result

- Requirement: connect the original events, screen facts, wallet evidence, configuration, decision, control assignment, order intent, attempts, observations, and accounting entries.
- Status: partial.
- What exists: the tables listed in the specification, written by the ingestor and the screener. `packages/core/src/db/phasec.ts` still recomputes screen facts.
- Remaining work: one read path for the report and the portfolio. Duplicate handling for a decision, not only for ingest.
- Dependency: ING-002, EXE-001.
- Implementation location: `packages/core/src/db/ingest.ts`, `packages/core/src/db/phasec.ts`.
- Later acceptance: from one decision id, a command prints the event ids, the list version, the intent, and the cash rows without reading a cache that was overwritten.

### ACC-002. Quantities, cash, fees, and corrections

- Requirement: exact token quantities and cash movements, including fees, partial exits, failed attempts that cost money, reserved cash, and unresolved holdings. A correction keeps the original row and explains itself.
- Status: partial.
- What exists: position size fields and dry-run notionals. Scale-out booking is partial and held off.
- Remaining work: the cash ledger and the correction row.
- Dependency: D4, D5.
- Implementation location: `phasec_position` and `autobuy_intent` in `ingest.ts`.
- Later acceptance: a failed attempt that spent a fee reduces cash and keeps the attempt. A correction does not delete the first row.

### ACC-003. Replay

- Requirement: deterministic replay of a decision and its result, including duplicate delivery.
- Status: partial.
- What exists: `apps/ingestor/src/replay.ts` replays stored ingest. Closed pull requests #14 and #15 are in #60.
- Remaining work: replay of the decision and the accounting, not only the raw event.
- Dependency: ACC-001.
- Implementation location: `apps/ingestor/src/replay.ts`.
- Later acceptance: the same fixture twice yields one decision and one cash result.

### RSK-001. One policy on every entry path

- Requirement: one versioned policy for cash, size, liquidity, impact, concentration, transfer restrictions, freshness, exposure, and admission. No worker or retry can bypass it.
- Status: partial.
- What exists: `risk.ts`, `screen.ts`, and `admitAutobuy`.
- Remaining work: a single call and a stored policy version on every path, including a retry.
- Dependency: D1, D6.
- Implementation location: `packages/core/src/phasec/risk.ts`.
- Later acceptance: a direct call that skips the policy cannot write a position. The test names the path that tried.

### RSK-002. Failures, pauses, and open positions

- Requirement: define which failures stop new entries, which stop diagnostics, and how an open position and reserved cash survive a restart.
- Status: partial.
- What exists: the diagnostic runner stops its own jobs at the credit ceiling and does not stop the ingestor. The deployment notes say a pause stays with the operator. Reserved cash across a restart is not one balance.
- Remaining work: the restart balance and the written failure map.
- Dependency: ACC-002.
- Implementation location: `apps/ingestor/src/diagnosticRun.ts`, `docs/deployment-acceptance.md`.
- Later acceptance: kill the diagnostic process and the ingestor process separately. The position and the reserved cash are still the stored values after both restarts.

### DSH-001. Owner operating view

- Requirement: show services and mode, release identity, feed health and gaps, opportunities and reasons, wallet evidence, positions and cash, provider and diagnostic spend, strategy limits, and alert configuration. Empty, stale, and unavailable are explicit. Secrets are not shown. Controls cannot turn trading on by accident.
- Status: not built.
- What exists: no HTML or application view. `scripts/cutover-report.sh` prints some of these fields and prints `not recorded` when the value is absent. Telegram `/status` and `/events` exist in `apps/alerter/src/commands.ts`. The alerter is stopped.
- Remaining work: a private authenticated web dashboard wired to the authoritative records. Telegram stays optional and held.
- Dependency: ACC-001.
- Implementation location: not built. The script is `scripts/cutover-report.sh`.
- Later acceptance: with the services stopped, the view shows stopped and the release identity of the running commit. A fixture-only page is not accepted.

### ALT-001. Alerts implemented and held off

- Requirement: alert formatting and delivery exist, and the current hold stays.
- Status: partial.
- What exists: `packages/core/src/phasec/deliver.ts` formats an alert. `apps/alerter` is behind the `paper` profile and `serviceGate`. `stoppedState.test.ts` checks the gate.
- Remaining work: the hold is the part that is enforced in CI. Delivery to an owner is not a completed operating view.
- Dependency: D8.
- Implementation location: `apps/alerter`, `packages/core/src/phasec/deliver.ts`.
- Later acceptance: CI still fails a deploy that starts the alerter. A manual command with the flag off sends nothing.

### MON-001. Feed, spend, and crash monitoring

- Requirement: lag, recovery, and gaps by feed; provider usage and remaining diagnostic allowance; crash report.
- Status: partial.
- What exists: `ingest_status`, `ingest_month`, `diagnostic_spend`, `scripts/cutover-report.sh`, and `packages/core/src/telegram/crashAlert.ts`.
- Remaining work: these are tables and a script. They are not the owner view.
- Dependency: D8.
- Implementation location: `scripts/cutover-report.sh`, `packages/core/src/phasec/diagnosticSpend.ts`.
- Later acceptance: a stopped feed shows a gap and does not invent a checkpoint. Spend above the ceiling stops the diagnostic jobs and leaves the ingestor running.

### EVL-001. Evaluation programs

- Requirement: deterministic replay, failure scenarios, execution reconciliation, matched controls, portfolio simulation, fee sensitivities, missing-outcome bounds, and a final report. Scenarios cover outages, migrations, duplicates, restarts, stale data, unavailable quotes, uncertain execution, partial exits, budget exhaustion, and permission failures.
- Status: partial.
- What exists: ingest replay, diagnostic CI, migration rehearsal, and `review3.ts` calibration scenarios with inferential Go left false. Closed pull requests #51, #54, and #56 are in #60.
- Remaining work: one runner and one report over the authoritative records. Uncertain execution and partial exits wait on EXE-001. D12 fixes the comparison first.
- Dependency: D12, ACC-001, EXE-001.
- Implementation location: `packages/core/src/phasec/review3.ts`, `apps/ingestor/src/replay.ts`, `.github/workflows/ci.yml`.
- Later acceptance: the command list runs on a fixture and writes the report. A passing fixture is not a claim of an edge. Inferential Go is still off.

### REL-001. Direct-to-main release route

- Requirement: one held pull request into `main`, with the base SHA, candidate SHA, and tree hash recorded, and a post-merge tree check prepared.
- Status: build-complete.
- What exists: pull request #60. Base `6555907ee2a0cdf45a6b5cc7dafe92790d833a6b`. Candidate `a7a796384c178b9c659ce9751cd4bf20dc05d339`. Tree `ab53a6c662c2e35ae17c5cffb58bcd3ba663e47c`. `scripts/check-merged-tree.sh`. Push CI run `45462755214` is green. The pull request is not merged.
- Remaining work: the owner disables the Deploy workflow that is already on `main`, then merges and runs the tree check. This matrix does not do that.
- Dependency: none.
- Implementation location: `.github/workflows/deploy.yml`, `scripts/check-merged-tree.sh`, `scripts/hold-deploy-workflow.sh`.
- Later acceptance: after a future merge, `origin/main`'s tree equals the reviewed tree. The merge commit id may differ. Until that command is run, this row is not validated.

### REL-002. No indirect deploy or publish trigger

- Requirement: deploy and publish run only by `workflow_dispatch`. Ordinary CI may still run on push.
- Status: build-complete.
- What exists: `scripts/check-deploy-triggers.mjs` checks `push`, `pull_request`, `workflow_run`, `workflow_call`, `repository_dispatch`, and `schedule`, and a reusable call to `deploy.yml`. The green compose job printed `no direct or indirect deploy trigger`.
- Remaining work: the workflow file already on `main` is older and still has a push trigger. Disabling it is an owner step, REL-001.
- Dependency: REL-001.
- Implementation location: `.github/workflows/deploy.yml`, `.github/workflows/publish.yml`, `.github/workflows/ci.yml`.
- Later acceptance: on the merged commit, the same script passes, and the live Deploy workflow is disabled before the merge.

### REL-003. Retained artifact and publish without a rebuild

- Requirement: bind the OCI archive to the repository, run, commit, artifact id, checksum, index digest, and `linux/amd64` image. Publish selects that artifact. A missing, expired, altered, or wrong-run archive stops publication. The copy does not rebuild.
- Status: partial.
- What exists: push run `45462755214` artifact `14953876440`, retained 90 days, expiring `2027-02-22T18:44:25Z`. OCI archive checksum `b8557f88d2669ea75e2c716b739e9d1a1e1ee03ad4a95d09d0111bfb0d89e425`. Index digest `sha256:06762134cf090867561ad4f471e9a8456ca4245957a22d663c1522a9cff7eb09`. Image id `sha256:6c4e0f1bcd1cccc1fb75840f0e2ee84a874088509d6c71e21459e93014009de7`. The compose job copied that archive to a local registry, wrote the original index, and pulled the same digest. `pushed` is false. Publish has not been dispatched.
- Remaining work: the handoff file says `artifactId` `pending-upload` because the id is assigned after upload. Publish must be given run `45462755214` and artifact `14953876440` only for this commit. A later commit needs a new artifact. That dispatch is not this step.
- Dependency: REL-001.
- Implementation location: `scripts/record-release-digest.sh`, `scripts/verify-release-handoff.sh`, `scripts/copy-tested-oci.sh`, `.github/workflows/publish.yml`.
- Later acceptance: a dispatch with the wrong artifact id fails before a registry write. A dispatch with this id pushes the same index digest. This acceptance has not been run.

### REL-004. Deploy account and the permission gap

- Requirement: the deploy account is not root and is not in the `docker` group. One sudo command accepts only the fixed helper. The helper reads one digest from a root-owned manifest and operates fixed services. The account can complete the guarded procedure, or the procedure names the remaining root step.
- Status: partial.
- What exists: `scripts/setup-deploy-user.sh` and `scripts/fomo-deploy-helper`. CI created the user, ran the bootstrap twice, and left root's authorized keys unchanged. `rehearse` from `/tmp` with `COMPOSE_PROJECT_NAME=evil` and `DOCKER_HOST=tcp://127.0.0.1:9` still printed project `fomo-copilot`, context `default`, volume `fomo-copilot_pgdata`, and the existing Postgres container. `docker` as that user failed. The helper and the manifest were not writable by the user. An unprivileged bootstrap exited with `one-time: create deploy user is the only root step`.
- Remaining work: add `diagnostic-start`, `diagnostic-status`, and `diagnostic-stop` to the helper. Each command is fixed. The account still gets no socket and no docker group.
- Dependency: D9.
- Implementation location: `scripts/fomo-deploy-helper`, `scripts/setup-deploy-user.sh`.
- Later acceptance: as `fomo-deploy`, the six commands stay inside the fixed project. If D9 adds a diagnostic command, it accepts no image override and still cannot run an arbitrary shell. If D9 keeps the root step, the procedure says so in one line and the account's socket denial still fails `docker ps`.

### REL-005. Database preparation

- Requirement: the diagnostic role is the minimum reviewed SQL. The broader role plan stays unapplied until a separate decision.
- Status: partial.
- What exists: `infra/sql/fomo-shadow-diagnostic.sql`. CI applies it inside the compose job. `infra/db/shadow-roles.sql` says not to apply it. Pull request #41 is open against `main` and is not in #60.
- Remaining work: production application is a later owner step. D11.
- Dependency: D11.
- Implementation location: `infra/sql/fomo-shadow-diagnostic.sql`.
- Later acceptance: on a copy of production, the role can read `ingest_month` and write the diagnostic spend tables, and a write to `raw_events` fails. This has not been run on production.

### REL-006. Guarded deployment procedure

- Requirement: the owner steps, the rollback controller, the schema-drift stop, and the restore rehearsal are written and the code they call is the code on the release branch.
- Status: partial.
- What exists: `docs/deployment-acceptance.md`, `scripts/install-rollback-controller.sh`, `scripts/halt-on-schema-drift.sh`, `scripts/restore-and-upgrade.sh`. CI rehearses the restore on a synthetic database. The document still names `cursor/review-8-approval-8ff7` in one merge sentence. The merge target is pull request #60.
- Remaining work: correct that sentence when the next code change is allowed. Do not treat the #60 digest as evidence for later commits.
- Dependency: REL-001, REL-004.
- Implementation location: `docs/deployment-acceptance.md`.
- Later acceptance: a reader can follow the steps without merging a closed stack pull request, and a schema mismatch stops before `migrate()`.

### PRK-001 through PRK-007. Parked capability rows

These rows repeat the disposition table so the matrix has one place for each parked capability.

| ID      | Requirement                       | Status    | What exists and where                                                                                    | Remaining work                                                     | Dependency | Implementation location                  | Later acceptance                                                                 |
| ------- | --------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| PRK-001 | Four stages and scale-out         | partial   | `protocol.ts` stages. Scale-out accounting exists and is off.                                            | Config, precedence, and readiness for every included stage.        | RDY-001    | `packages/core/src/phasec/protocol.ts`   | Each stage trades on ready data or records `unavailable`.                        |
| PRK-002 | Second wave                       | partial   | `secondWave.ts` and the second-wave arms. D12 keeps it out of the primary comparison.                    | A secondary strategy with its own position owner.                  | STR-002    | `packages/core/src/phasec/secondWave.ts` | It cannot open a second position on a mint the primary path already holds.       |
| PRK-003 | Live mint-linked social collector | not built | Fixture source and `coin_x_mention`. No live collector.                                                  | Bounded collector and budget gate. No paid subscription.           | none       | `packages/core/src/ingest/xMentions.ts`  | A missing post is `unknown`. The monthly counter stops the collector at the cap. |
| PRK-004 | Creator module                    | not built | Creator-sell count in `screen.ts`. Creator rows dropped in `wallets.ts`.                                 | Holdings, sales, previous launches, and relationship rows.         | ACC-001    | not built                                | A shared funder is stored and is not labeled common control.                     |
| PRK-005 | 30-day observed history           | not built | `pump_trade`, `wallet_fill`, market snapshots.                                                           | 1-minute aggregates, explicit gaps, and archival jobs.             | none       | `packages/core/src/db/ingest.ts`         | A missing minute is a gap row, not a zero.                                       |
| PRK-006 | Automatic entry and exit          | not built | Dry-run intent. Live throws because signing is not implemented. That throw is not the finished workflow. | State machine, signer, reservation, and kill switches. Tests only. | EXE-001    | `packages/core/src/autobuy/run.ts`       | A timeout does not create a second buy. Deploy keeps `AUTOBUY_MODE=dry_run`.     |
| PRK-007 | Flap parser archived              | partial   | `flap.ts` and `bsc.ts`. Flap trading is not built.                                                       | Disable the socket in the Solana deployment and keep the rows.     | none       | `apps/ingestor/src/bsc.ts`               | The default Solana start opens no BSC socket.                                    |

### FLOW-001. One path from ingest to evaluation

- Requirement: one workflow from ingest, through wallet classification, screening and risk, the decision, execution, reconciliation, the owner view, and evaluation.
- Status: not built.
- What exists: separate ingestor, screener, and diagnostic processes. They do not share one decision id from the event to the report.
- Remaining work: the shared id and the handoff between those processes.
- Dependency: ACC-001, EXE-001, DSH-001, EVL-001.
- Implementation location: not built.
- Later acceptance: one fixture mint produces one id that is present in the event, the decision, the execution attempt, the dashboard, and the evaluation export.

### STR-002. Strategy interactions

- Requirement: competing signals on one mint, stage transitions, position ownership, a shared bankroll, duplicate orders, and outcome attribution are explicit.
- Status: not built.
- What exists: several arms in `protocol.ts`. No owner is stored when two stages want the same mint.
- Remaining work: one position owner per mint and one bankroll reservation.
- Dependency: STR-001, ACC-002.
- Implementation location: `packages/core/src/phasec/protocol.ts`.
- Later acceptance: two signals on one mint create one order. The other signal is stored as not admitted. The cash is reserved once.

### PERM-001. Persistence and permission map

- Requirement: every process has a written list of the tables it reads and writes and the database role it uses.
- Status: not built.
- What exists: the diagnostic role file and the unapplied broader role file. The ingestor still uses the application role.
- Remaining work: the map and the least-privilege roles. Nothing is applied to production.
- Dependency: REL-005.
- Implementation location: `infra/sql/`.
- Later acceptance: each process connects as its own role, and a write outside its list fails.

### RDY-001. Build readiness is not data readiness

- Requirement: a feature can be implemented while its inputs are unavailable. The unavailable state is stored and shown. It is not a zero and not a pass.
- Status: not built.
- What exists: some screens already omit a missing value. There is no shared `unavailable` result.
- Remaining work: one result used by stages, social data, routes, and the dashboard.
- Dependency: none.
- Implementation location: not built.
- Later acceptance: a stage with no route records `unavailable` and does not size a position.

### REL-007. One later release

- Requirement: the finished build has its own release evidence and its own retained artifact. Pull request #60's green head does not cover later commits.
- Status: not built.
- What exists: the #60 route, artifact `14953876440`, and digest `sha256:06762134cf090867561ad4f471e9a8456ca4245957a22d663c1522a9cff7eb09`.
- Remaining work: after the included rows are build-complete, cut one release from that commit. Do not reuse the earlier digest.
- Dependency: REL-001, REL-003.
- Implementation location: `.github/workflows/publish.yml`.
- Later acceptance: the new push run's commit equals the release head, and the old digest is on the refuse list.

## Reuse map

| Work                                                                                                                               | Where it lives                                              | In #60                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| Phase 0 through Phase C paper, wallet score, Flap intake, multi-venue intake                                                       | Closed pull requests #1 through #30                         | Yes, through `main` history or the stack     |
| Dry-run auto-buyer                                                                                                                 | Closed pull request #35                                     | Yes                                          |
| Screening hotfixes on `main`                                                                                                       | Closed pull requests #36, #37, #38                          | Yes, they are on `main` and therefore in #60 |
| Open paper-test hotfix and `scripts/verdict.sql`                                                                                   | Open pull request #39, `hotfix/final-paper-test-2026-11-23` | No. Decision D10                             |
| Scale-out booking, cost model, wallet fills, candidate log, feed telemetry, experiment preregistration, wide recovery, measurement | Closed pull requests #40 and #42 through #56                | Yes                                          |
| Release candidate, diagnostic role, artifact handoff, deploy helper                                                                | Closed pull requests #57 through #59, open pull request #60 | Yes. #60 is the held head                    |
| Broader database roles                                                                                                             | Open pull request #41                                       | No. Decision D11                             |
| Dependency bumps                                                                                                                   | Open pull requests #5 through #9 and #31 through #33        | No. Not part of this product inventory       |

## What this matrix does not ask for

It does not ask for a merge, a publish, a server change, a diagnostic launch, alerts, paper trading, a signing key, `AUTOBUY_LIVE_CONFIRMED`, or a new paid service. The $25 diagnostic ceiling stays the ceiling for that later activity. It is not a budget for new subscriptions.
