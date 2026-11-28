# Completion matrix

Version: 2026-11-28.3. Specification: `docs/completion/master-spec.md`.

Status is `not built`, `partial`, or `build-complete`. Nothing below is validated. Counts at this version: 41 rows, of which 21 are build-complete, 19 are partial, and 1 is not built. The twelve scope choices are settled. No row is awaiting a decision. Five rows are build-complete. They have not been executed on production. Pull request #60 does not cover the later commits.

Locations are on `cursor/release-main-8ff7` unless a row says otherwise. Closed pull requests #1 through #38 and #40 and #42 through #59 are ancestors of #60 or older `main` work already contained in it, except where a row names a branch that is not. Pull request #39 is not an ancestor of #60. Pull request #41 is not an ancestor of #60.

## Settled scope

Settled by Arvin on 28 November 2026. The build rule is to make the best decision for the build. These are included or excluded. None are awaiting a decision. They are not a request to launch the diagnostic or to change production.

| ID  | Settled choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Included: trench, near graduation, post graduation, and second wave, plus every exit policy including scale-out. Each stage has an explicit config, a precedence order, and a data-readiness rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | Included: a bounded live collector that links posts to a mint, behind a provider budget gate. Fixtures are for development. Missing or stale social data is `unknown`. No X API tier is subscribed or paid. A paid provider is an activation that needs a later yes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D3  | Included: a creator module for holdings, sales, previous launches, and evidenced wallet relationships. A shared funder is not proof of common control.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D4  | Included: 30-day rolling observed swap and liquidity history for the declared monitored universe, as 1-minute aggregates with explicit gaps. This is not a full-chain archive. Experiment inputs and records are kept through the run and at least 90 days after closure, then archived rather than discarded. Execution ledgers, fills, creator history, configs, and audit rows have their own archival policy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D5  | Included: Jupiter Swap V2 (`GET /swap/v2/order`, `POST /swap/v2/execute`) is the primary execution path. Copilot controls eligibility, size, and risk. The trading wallet is dedicated and limited-funded. FOMO is optional manual trading only, because FOMO terms restrict automation. Every included stage records whether a buy route and a sell route exist. An unsupported route is `unavailable`. The cost model uses Jupiter platform fee, network fees, tips, token-account rent and recovery, failed transactions, pool fees, and slippage. It does not apply FOMO fees to a Jupiter quote.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
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
- Status: build-complete.
- What exists: this file and `docs/completion/master-spec.md`. D1 through D12 are settled in the decision table. No row is awaiting a decision.
- Remaining work: none for the inventory. Individual features stay partial until their own rows say build-complete.
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
- Status: build-complete.
- What exists: `decisionTimes` stores chain time, observation time, and decision time separately, plus parser version `solana-2026-11-28`. `eventVisibleToDecision` marks a later backfill as not visible. The workflow stores both.
- Remaining work: none for that check. Older ingest rows do not all carry the three times yet.
- Dependency: ACC-001.
- Implementation location: `packages/core/src/db/ingest.ts`.
- Later acceptance: a replay inserts a late event and the earlier decision row still shows that the event was absent at decision time.

### ING-003. Flap parser

- Requirement: keep the Flap parser archived and disconnected from the Solana deployment. Preserve stored rows.
- Status: build-complete.
- What exists: `packages/core/src/ingest/flap.ts`, `apps/ingestor/src/bsc.ts`, migration `015_bsc_flap`. Closed pull requests #23 and #24, contained in #60. Flap trading is not built.
- Remaining work: the Solana deployment must not open the BSC socket. The parser and stored rows stay.
- Dependency: none. D7 is settled.
- Implementation location: `apps/ingestor/src/bsc.ts`, `apps/ingestor/src/main.ts`.
- Later acceptance: with the Solana flag at its default, the process starts no BSC socket. Existing `ingest_chain_event` rows are still readable.

### WAL-001. Three wallet measures

- Requirement: keep graduation activity, the wallet's own result, and a follower at the system's delay and cost as separate measures.
- Status: build-complete.
- What exists: the wallet job calls `saveOwnerWalletRecords` with graduation, own-result, and follower rows. A missing follower price is stored as `insufficient`. The scorer still drops that row from the ranked list.
- Remaining work: none for the stored measures. The ranked list is still a separate score.
- Dependency: D4, ACC-001.
- Implementation location: `packages/core/src/ingest/wallets.ts`.
- Later acceptance: one fixture wallet produces three stored results, and a missing exit is visible as insufficient data.

### WAL-002. Activity classification

- Requirement: classify swaps, transfers, wrapped SOL, fees, and account movements. Leave unclassified rows visible.
- Status: build-complete.
- What exists: `classifyMovement` labels the five classes and `unclassified`. `saveOwnerWalletRecords` stores the class. The wallet job stores a swap for each buy or sell it already has.
- Remaining work: none for the classifier. A live instruction stream beyond buys and sells is not required for the stored bucket.
- Dependency: D4.
- Implementation location: `packages/core/src/ingest/walletIntelligence.ts`. The wallet job is `apps/ingestor/src/walletJob.ts`.
- Later acceptance: a fixture with one of each movement stores five classes plus any row that matched none.

### WAL-003. Evidence, concentration, and shared funding

- Requirement: report sample size, missingness, holding period, downside, and concentration in exceptional winners. Record shared funding without treating it as common control.
- Status: build-complete.
- What exists: the wallet job stores the evidence report and shared-funding rows. `common_control` is constrained to false.
- Remaining work: none for the report. A shared funder does not merge wallets.
- Dependency: WAL-001.
- Implementation location: `packages/core/src/ingest/walletIntelligence.ts`.
- Later acceptance: a wallet with one large winner shows the concentration, and a shared funder does not by itself merge two wallets.

### WAL-004. Frozen cohort

- Requirement: use only information available before the decision. Do not replace the cohort during a frozen experiment.
- Status: build-complete.
- What exists: the decision stores list version `v3`. `listUsable` refuses a later list. `mayApplyV3List` still refuses a replacement while paper is open.
- Remaining work: none for the version check. The live qualification cohort is still unset.
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
- What exists: `phasec_candidate` and `entryDecision` in `risk.ts`. Candidates are not the same table as positions. A paused log can add a recorded-only row, so the counts are not yet the same.
- Remaining work: a pause that leaves both the candidate count and the control count unchanged.
- Dependency: ACC-001.
- Implementation location: `packages/core/src/phasec/risk.ts`, `packages/core/src/db/phasec.ts`.
- Later acceptance: after a forced pause, the candidate count and the control count are unchanged.

### STR-001. Strategy stages and scale-out

- Requirement: implement only the stages and exit treatments D1 includes, and keep the others disabled without calling them complete.
- Status: build-complete.
- What exists: `INCLUDED_STAGES` names the four included stages. `stageAdmission` returns `unavailable` for an unknown stage and for an unready included stage, and it does not open a position.
- Remaining work: none for that gate. Scale-out stays off in the primary comparison.
- Dependency: RDY-001.
- Implementation location: `packages/core/src/phasec/`.
- Later acceptance: an excluded stage cannot open a position, and an included stage writes a decision with the policy version.

### EXE-001. Selected execution workflow

- Requirement: implement the chosen route from intended spend through quote, eligibility, submission or manual handoff, acknowledgement, status, receipt, and holdings.
- Status: build-complete.
- What exists: `placeSwap` builds the Swap V2 order and execute requests and does not send them. The workflow stores the held execution, the reconciliation step, and the test-key signature. A second run of the same id does not create a second intent.
- Remaining work: none for the simulated path. A real acknowledgement waits on an owner decision to fund a wallet and lift the submission hold.
- Dependency: ACC-001, RSK-001.
- Implementation location: `packages/core/src/autobuy/run.ts`, `packages/core/src/phasec/fomoLookup.ts`.
- Later acceptance: each terminal and unresolved state has a stored row. A second automatic submission does not follow an uncertain first submission.

### EXE-002. Quoted, simulated, and actual stay distinct

- Requirement: label quotes, simulations, and fills separately. Store assumed fees and observed charges separately.
- Status: build-complete.
- What exists: the workflow stores a quote step, a held simulation, and a fill step whose state is `absent`. `executionEconomics` keeps the three values separate and does not add them.
- Remaining work: none for the labels. A realized fee stays unknown until a real acknowledgement.
- Dependency: D5.
- Implementation location: `packages/core/src/phasec/protocol.ts`, `packages/core/src/db/ingest.ts` table `autobuy_intent`.
- Later acceptance: one opportunity can show a quote, a simulated intent, and no fill, and the report does not add them together.

### ACC-001. One record from event to result

- Requirement: connect the original events, screen facts, wallet evidence, configuration, decision, control assignment, order intent, attempts, observations, and accounting entries.
- Status: build-complete.
- What exists: `readDecisionRecord` returns the event id, the policy version, the intent count, and the cash rows for one run id. A second run does not add a second intent.
- Remaining work: none for that read path. Screen facts are still recomputed by the screener for its own tables.
- Dependency: ING-002, EXE-001.
- Implementation location: `packages/core/src/db/ingest.ts`, `packages/core/src/db/phasec.ts`.
- Later acceptance: from one decision id, a command prints the event ids, the list version, the intent, and the cash rows without reading a cache that was overwritten.

### ACC-002. Quantities, cash, fees, and corrections

- Requirement: exact token quantities and cash movements, including fees, partial exits, failed attempts that cost money, reserved cash, and unresolved holdings. A correction keeps the original row and explains itself.
- Status: build-complete.
- What exists: `cash_entry` stores the attempt and a later correction as new rows. The attempt is not deleted. The simulated attempt records a zero fee because no network fee was observed.
- Remaining work: none for the ledger shape. A real fee amount waits on a real acknowledgement.
- Dependency: D4, D5.
- Implementation location: `phasec_position` and `autobuy_intent` in `ingest.ts`.
- Later acceptance: a failed attempt that spent a fee reduces cash and keeps the attempt. A correction does not delete the first row.

### ACC-003. Replay

- Requirement: deterministic replay of a decision and its result, including duplicate delivery.
- Status: build-complete.
- What exists: running the simulated workflow twice for one id keeps one decision, one intent, and one attempt. Ingest replay remains in `apps/ingestor/src/replay.ts`.
- Remaining work: none for the duplicate decision. Ingest replay is unchanged.
- Dependency: ACC-001.
- Implementation location: `apps/ingestor/src/replay.ts`.
- Later acceptance: the same fixture twice yields one decision and one cash result.

### RSK-001. One policy on every entry path

- Requirement: one versioned policy for cash, size, liquidity, impact, concentration, transfer restrictions, freshness, exposure, and admission. No worker or retry can bypass it.
- Status: build-complete.
- What exists: `applyEntryPolicy` is the gate the simulated workflow calls before it writes a position. The policy version is stored on the decision. A null policy cannot write a position.
- Remaining work: none for that gate. The screener's older checks still exist beside it.
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
- Status: build-complete.
- What exists: `apps/dashboard/src/main.ts` listens on 127.0.0.1 only when `DASHBOARD_ENABLED=true` and `DASHBOARD_TOKEN` is set. It reads `owner_service`, `owner_feed`, `workflow_step`, `owner_position`, and `wallet_evidence_report`. Empty, stale, and unavailable stay explicit. The token is not in the body. There is no trading route. The process stays stopped when the flag is off.
- Remaining work: none for the view. It is not in the default compose project, so a deploy does not start it.
- Dependency: ACC-001.
- Implementation location: `apps/dashboard/src/main.ts`, `packages/core/src/dashboard/server.ts`.
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
- Status: build-complete.
- What exists: the dashboard shows feed gaps and diagnostic spend remaining. A feed row with `gap` true is shown as a gap. The diagnostic runner still stops its own jobs at the credit ceiling and leaves the ingestor running.
- Remaining work: none for this view. Spend above the ceiling is the existing diagnostic stop.
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

- Requirement: the deploy account is not root and is not in the `docker` group. One sudo command accepts only the fixed helper. The helper reads one digest from a root-owned manifest and operates fixed services, including diagnostic start, status, and stop.
- Status: build-complete.
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

| ID      | Requirement                       | Status         | What exists and where                                                                                                  | Remaining work                                               | Dependency | Implementation location                     | Later acceptance                                                                 |
| ------- | --------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| PRK-001 | Four stages and scale-out         | partial        | `protocol.ts` stages. Scale-out accounting exists and is off.                                                          | Config, precedence, and readiness for every included stage.  | RDY-001    | `packages/core/src/phasec/protocol.ts`      | Each stage trades on ready data or records `unavailable`.                        |
| PRK-002 | Second wave                       | partial        | `secondWave.ts` and the second-wave arms. D12 keeps it out of the primary comparison.                                  | A secondary strategy with its own position owner.            | STR-002    | `packages/core/src/phasec/secondWave.ts`    | It cannot open a second position on a mint the primary path already holds.       |
| PRK-003 | Live mint-linked social collector | partial        | `socialCollect.ts` with the live cap at zero. No provider is called.                                                   | Wire the collector to admitted mints. No paid subscription.  | none       | `packages/core/src/ingest/socialCollect.ts` | A missing post is `unknown`. The monthly counter stops the collector at the cap. |
| PRK-004 | Creator module                    | partial        | `creator/record.ts` stores holdings, sales, launches, and relationships.                                               | Connect it to stored trades.                                 | ACC-001    | `packages/core/src/creator/record.ts`       | A shared funder is stored and is not labeled common control.                     |
| PRK-005 | 30-day observed history           | partial        | `history/minutes.ts` keeps raw events. A covered quiet minute is volume 0. An uncovered minute is a gap.               | Fill the table from stored trades and archive after closure. | none       | `packages/core/src/history/minutes.ts`      | A quiet covered minute is zero. A minute with no coverage is a gap.              |
| PRK-006 | Automatic entry and exit          | partial        | The ledger authorizes one intent. The book holds submission. Entry pause, exits-only, and a signing halt are separate. | Send no Jupiter order. Connect exits to positions.           | EXE-001    | `packages/core/src/execution/book.ts`       | A timeout does not create a second buy. Deploy keeps `AUTOBUY_MODE=dry_run`.     |
| PRK-007 | Flap parser archived              | build-complete | `BSC_INGEST` defaults to off. The parser and stored rows stay.                                                         | None for the archive. Trading stays excluded.                | none       | `apps/ingestor/src/bsc.ts`                  | The default Solana start opens no BSC socket.                                    |

### FLOW-001. One path from ingest to evaluation

- Requirement: one workflow from ingest, through wallet classification, screening and risk, the decision, execution, reconciliation, the owner view, and evaluation.
- Status: build-complete.
- What exists: `runSimulatedWorkflow` stores one run id on the event, the decision, the held execution, the ledger step, and the evaluation step. The dashboard reads that id. No order is sent.
- Remaining work: none for the simulated path. The live processes do not start this path on their own.
- Dependency: ACC-001, EXE-001, DSH-001, EVL-001.
- Implementation location: `packages/core/src/workflow/run.ts`.
- Later acceptance: one fixture mint produces one id that is present in the event, the decision, the execution attempt, the dashboard, and the evaluation export.

### STR-002. Strategy interactions

- Requirement: competing signals on one mint, stage transitions, position ownership, a shared bankroll, duplicate orders, and outcome attribution are explicit.
- Status: partial.
- What exists: `phasec/admission.ts` admits one signal, stores the other as not admitted, and reserves that cash once. Exit capacity stays out of the entry.
- Remaining work: the screener does not call this admission yet, so two live arms can still both be considered.
- Dependency: STR-001, ACC-002.
- Implementation location: `packages/core/src/phasec/admission.ts`.
- Later acceptance: two signals on one mint create one order. The other signal is stored as not admitted. The cash is reserved once.

### PERM-001. Persistence and permission map

- Requirement: every process has a written list of the tables it reads and writes and the database role it uses.
- Status: partial.
- What exists: `db/permissions.ts` lists each process, its role, and the tables it reads and writes. The signer has no login. `PERMISSIONS_APPLIED` is false. The SQL file is still unapplied, and the ingestor still uses the application role.
- Remaining work: connect each process as its own role. Nothing is applied to production.
- Dependency: REL-005.
- Implementation location: `packages/core/src/db/permissions.ts`, `infra/sql/fomo-product-roles.sql`.
- Later acceptance: each process connects as its own role, and a write outside its list fails.

### RDY-001. Build readiness is not data readiness

- Requirement: a feature can be implemented while its inputs are unavailable. The unavailable state is stored and shown. It is not a zero and not a pass.
- Status: partial.
- What exists: `records/readiness.ts` returns `unavailable` with a null value when a route is missing, and does not turn that into a size.
- Remaining work: stages, social data, and the dashboard do not all use this result yet.
- Dependency: none.
- Implementation location: `packages/core/src/records/readiness.ts`.
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
