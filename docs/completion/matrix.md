# Completion matrix

Version: 2026-11-28.1. Specification: `docs/completion/master-spec.md`.

Status is `not built`, `partial`, or `build-complete`. Nothing below is validated. Counts at this version: 36 rows, of which 2 are build-complete, 30 are partial, and 4 are not built. Twelve owner decisions are open. The two build-complete rows are the release route and the trigger check on pull request #60. They have not been executed on production.

Locations are on `cursor/release-main-8ff7` unless a row says otherwise. Closed pull requests #1 through #38 and #40 and #42 through #59 are ancestors of #60 or older `main` work already contained in it, except where a row names a branch that is not. Pull request #39 is not an ancestor of #60. Pull request #41 is not an ancestor of #60.

## Owner decisions

These are the unresolved scope choices. They are not requests to launch the diagnostic or to change production.

| ID  | Decision                                                                                                             | Why it is open                                                                                                                                                                             | Known fact                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Which stages and exit treatments are in the finished product.                                                        | `trench`, `near_graduation`, `post_graduation`, second wave, and scale-out all exist as code. The experiment preregistration leaves second wave and scale-out out of that experiment only. | No later instruction includes or excludes them for the whole product.                                                                                |
| D2  | X / social: live source, fixture-only weight, or remove.                                                             | A weight and a fixture exist. A live collector does not.                                                                                                                                   | `xMentions.ts` says the live search is not this process.                                                                                             |
| D3  | Creator analytics: the current sell count, or a separate product.                                                    | The screen counts creator sells and the wallet score drops creator rows.                                                                                                                   | A creator-analytics product is not built.                                                                                                            |
| D4  | How much trade and liquidity history is required, and the retention for candidates, controls, rejections, and WATCH. | Trades and fills are stored for the screen and the wallet job.                                                                                                                             | A retention policy for those four classes is not written.                                                                                            |
| D5  | Execution route: automated FOMO, manual FOMO, or another named route.                                                | No route is implemented.                                                                                                                                                                   | `fomoLookup.ts` does not call FOMO. A Jupiter quote is not a FOMO fill. Signing is not implemented.                                                  |
| D6  | Whether automatic execution is in the finished product.                                                              | Dry-run intents can be stored. Live mode cannot start.                                                                                                                                     | Building a later signer would still not authorize installing a key.                                                                                  |
| D7  | Whether the existing BNB Chain Flap parser stays disabled or is removed.                                             | The 28 November 2026 directive sets Solana as the boundary.                                                                                                                                | Flap trading is not built. The parser must not be treated as an included chain.                                                                      |
| D8  | Whether Telegram is the owner view or a separate dashboard is required.                                              | There is no web UI. The alerter has four commands and is stopped.                                                                                                                          | The operating views listed in the specification are not built.                                                                                       |
| D9  | Whether `fomo-deploy` must be able to start the diagnostic container.                                                | The helper has six commands. Starting that container still needs root, because the account cannot open the Docker socket.                                                                  | CI showed the socket denial and showed that `rehearse` stays on project `fomo-copilot`. Putting the account in the `docker` group is not the repair. |
| D10 | Whether to reuse pull request #39.                                                                                   | That pull request is open against `main` and is not contained in #60.                                                                                                                      | It changes screening, sizing, the migration lock, and adds `scripts/verdict.sql`. Its behavior is not re-certified here.                             |
| D11 | Whether pull request #41's broader role file is ever applied.                                                        | #41 is a plan against `main` and is not in #60.                                                                                                                                            | The minimum file is `infra/sql/fomo-shadow-diagnostic.sql`. Neither file is applied on production.                                                   |
| D12 | The primary comparison, fixed before any scored multi-strategy result is read.                                       | More than one arm is coded.                                                                                                                                                                | The experiment preregistration is for one experiment, not for the finished multi-strategy product.                                                   |

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
- Remaining work: D7.
- Dependency: D7.
- Implementation location: `apps/ingestor/src/bsc.ts`.
- Later acceptance: if D7 removes it, the ingestor starts with no BSC socket. If D7 keeps it disabled, a test shows the socket is not required for Solana intake.

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
- Remaining work: D1. Then connect only the included stages to the risk engine and the records.
- Dependency: D1.
- Implementation location: `packages/core/src/phasec/`.
- Later acceptance: an excluded stage cannot open a position, and an included stage writes a decision with the policy version.

### EXE-001. Selected execution workflow

- Requirement: implement the chosen route from intended spend through quote, eligibility, submission or manual handoff, acknowledgement, status, receipt, and holdings.
- Status: not built.
- What exists: Jupiter quote collection and a dry-run intent. `JUPITER_SWAP_URL` is named in `autobuy/run.ts`. No order is submitted. Closed pull request #35 is in #60.
- Remaining work: D5 and D6, then the missing states. Do not invent a FOMO API.
- Dependency: D5, D6, ACC-001.
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
- Remaining work: D8, then the view reading the authoritative records rather than fixtures.
- Dependency: D8, ACC-001.
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
- Remaining work: the permission gap. The helper cannot start the diagnostic container. A root operator is still required for that start. D9 decides whether to add one fixed helper command or to keep that root step. Do not grant the socket.
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

| ID      | Requirement                   | Status  | What exists and where                                                                     | Remaining work | Dependency | Implementation location                  | Later acceptance                                                                                                           |
| ------- | ----------------------------- | ------- | ----------------------------------------------------------------------------------------- | -------------- | ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| PRK-001 | Additional strategy stages    | partial | `protocol.ts` stages `trench`, `near_graduation`, `post_graduation`                       | D1             | D1         | `packages/core/src/phasec/protocol.ts`   | An excluded stage cannot open a position.                                                                                  |
| PRK-002 | Second wave                   | partial | `secondWave.ts`; arms in `protocol.ts`; excluded from the experiment preregistration only | D1             | D1         | `packages/core/src/phasec/secondWave.ts` | Same as PRK-001.                                                                                                           |
| PRK-003 | X / social                    | partial | Fixture source and `coin_x_mention`. No live collector.                                   | D2             | D2         | `packages/core/src/ingest/xMentions.ts`  | If excluded, the score weight is unused. If included, the collector stores the post time and the decision time separately. |
| PRK-004 | Creator analytics             | partial | Creator-sell count in `screen.ts`. Creator rows dropped in `wallets.ts`.                  | D3             | D3         | `packages/core/src/phasec/screen.ts`     | The chosen scope is the only creator output.                                                                               |
| PRK-005 | Trade and liquidity history   | partial | `pump_trade`, `wallet_fill`, market snapshots                                             | D4             | D4         | `packages/core/src/db/ingest.ts`         | Retention for candidates, controls, rejections, and WATCH is a written rule and a test.                                    |
| PRK-006 | Automatic execution           | partial | Dry-run intent. Live throws `signing is not implemented`.                                 | D5, D6         | D5, D6     | `packages/core/src/autobuy/run.ts`       | If excluded, `live` still throws. If included, the signer is a separate later approval and is not installed here.          |
| PRK-007 | Flap trading and other chains | partial | Parser in `flap.ts` and `bsc.ts`. Flap trading is not built.                              | D7             | D7         | `apps/ingestor/src/bsc.ts`               | Solana intake does not require the BSC socket.                                                                             |

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
