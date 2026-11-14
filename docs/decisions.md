# Decision log

## 2026-11-14 — Parsed history scan for high-volume programs

An 82-slot deploy gap recovered DBC (134 transactions, 3 events) and then hit the 400-transaction startup cap on DAMM v2 (1,495 signatures listed, 399 fetched) and DLMM (1,992 listed, 400 fetched). Those programs list about 13–20 signatures per slot, almost all swaps. The restart spent about 1,290 credits and stored no DAMM or DLMM events.

Helius Parsed Events scan (`POST /v1/parsed-events/scan`, documented at https://www.helius.dev/docs/api-reference/parsed-events/scan) walks one address in pages of 1,000 transactions and keeps only the instruction names we send. It is on every plan. The charge is 10 credits per request plus 1 credit per page scanned, returned as `scan.creditsCharged`. The same 82-slot window is 11 + 12 + 12 = 35 scan credits, plus one `getTransaction` per matched initialize. `getTransactionsForAddress` can bound by slot but cannot filter by instruction name, so it would still return the swaps. The DBC event authority also appears on swaps, so listing a narrower account does not isolate initializes.

Startup and reconnect backfill for DAMM v2 and DLMM now scan `initialize_pool`, `initialize_customizable_pool`, `initialize_pool_with_dynamic_config`, `initialize_lb_pair`, `initialize_lb_pair2`, and the two customizable permissionless pair names, with `slot.gt` at the margin-adjusted live slot. DBC stays on the signature walk: 134 transactions already fit the startup cap. If the scan request fails, those two programs record `reason = high_volume_skipped` and do not fall back to fetching 400 transactions. `dbc_curve_complete` from a Swap2 is still filled when that full transaction is decoded. The live subscription does not include swap or swap2.

`ingest_backfill.reason` is nullable text (`005_backfill_reason`): `cap_hit`, `error`, `high_volume_skipped`, or `too_old`. A covered gap stores null.

## 2026-11-14 — Replay anchor, startup cap, Postgres env

The replay walked from the chain tip and treated a page as finished when fewer than 100 signatures remained after dropping failed transactions. `getSignaturesForAddress` pages are full at 100 rows before that filter. Historical windows also need a `before` cursor: `--anchor-signature` is a signature strictly above `--to-slot` (a later `raw_events` row, or any signature from `getBlock` of `--to-slot + 1`, which costs 1 credit). `--before` and `--until` pass through. Listing calls count toward the credit cap.

A deploy gap of about 71 slots held more than 60 DBC and DAMM transactions, so startup backfill hit the 60-transaction cap and recovered nothing. When the bound is the persisted live slot, the per-program cap is `STARTUP_BACKFILL_MAX_TX` (400). Wider gaps stay `unrecovered`. `getSignaturesForAddress` does not return instruction names, so those listings are not skipped; a name list is skipped only when one is present and none of the names are watched.

Postgres no longer mounts the app `.env`. Adding `BACKFILL_SLOT_MARGIN` changed that file and Compose recreated the database container. The service now receives only `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. The `pgdata` volume is unchanged. The deploy that introduces this config recreates the container once and remounts the same volume.

## 2026-11-14 — Backfill margin, unrecovered gaps, replay

Backfill now stops at `last_live_slot - BACKFILL_SLOT_MARGIN` (default 16) so a notification that arrives slightly out of order is still fetched. `raw_events` dedupe and the known-signature skip drop the overlap. If the scan hits the transaction cap or a fetch throws before that stop slot, the row is `unrecovered` with `gap_from_slot` and `gap_to_slot`, and the log line is `backfill unrecovered gap`. `scripts/unrecovered-gaps.sql` counts those rows.

A restart reads `ingest_status.last_slot`. When that slot is within 600 slots of the tip, startup backfill uses it minus the margin instead of the 60-transaction checkpoint scan. A missing or older cursor keeps the checkpoint window.

`ingest_heap_sample` stores `process.memoryUsage()` plus process uptime every 5 minutes. `scripts/event-gaps.sh` reports p50/p95/p99/max seconds between `raw_events`. `npm run backfill:replay` writes a historical slot window into a scratch schema, never `public`.

## 2026-11-14 — Keepalive and slot-bounded backfill

Production closed the parsed-stream socket every 5 minutes (`helius websocket closed`, no liveness warning). Helius drops a connection the client has not written to for 5 minutes, even while notifications are flowing. Node's built-in `WebSocket` cannot send ping frames, and the liveness probe only writes `getSlot` after evidence has already gone stale. The client now uses `ws` 8.22.0 and writes a protocol ping plus the documented JSON-RPC `ping` every 60 seconds. Protocol pings do not reset the separate 10-minute idle timer (no client messages and no notifications); the JSON-RPC `ping` does. Pongs and ping replies still count as liveness.

Backfill was matching the last stored event signature inside `getSignaturesForAddress`, which lists every transaction for the program. After a 1–2 second gap that signature is usually far behind the tip, so the scan took the 60-transaction cap (~180 credits per reconnect across three programs). Pages now stop when a signature's slot is at or below the last live slot, or the checkpoint slot when there is no live cursor. Signatures already in `raw_events` are not fetched again.

## 2026-11-14 — Soak follow-ups

The 24.7h soak on the filtered parsed stream reconnected about once per 24 minutes because 60 seconds without an ingest event closed the socket. Quiet stretches of that length are normal. Reconnects now require missed WebSocket pongs and stalled slots (`slotSubscribe`, then one `getSlot` probe). A warning is logged first. The socket closes only at the critical threshold. Telegram is sent when the following open fails, once per outage, not when a routine reconnect succeeds.

The live listener is attached before signature backfill. Backfill pages `getSignaturesForAddress` until the checkpoint or 40 calls, then fetches up to 60 of those signatures with `getTransaction` instead of skipping the whole gap. Each reconnect records gap seconds, gap slots, and events recovered in `ingest_backfill`. Decode failures (signature, program, instruction name, error, slot) go to `decode_failure` instead of being dropped. Instruction accounts are read by IDL name.

The two transfer-hook creates at slots 468993762 and 468993810 already decode to `dbc_initialize` with mint and pool. `PARSED_INSTRUCTION_NAMES` already contains `initialize_virtual_pool_with_token2022_transfer_hook`, which normalizes the same way as the log line `InitializeVirtualPoolWithToken2022TransferHook`. Those misses were the stream: a silence reconnect whose backfill then skipped `getTransaction`. Replay fixtures cover both transactions and a plain Token-2022 initialize.

`EvtCurveComplete` has pool, config, and reserves, and no mint. The swap in the same transaction names `base_mint` (IDL index of that name). The two curve fixtures (`2iUSeVV…` and `2C58UAP…`) fill `dbc_curve_complete.mint` from that account. A curve event with no swap and no initialize in the transaction still has a null mint, because the event payload does not carry one and `getTransaction` does not include virtual-pool account bytes.

Day 1 (2026-11-13, 1.26 GB, 103,197 messages, 28,939 credits) matches the pre-#11 byte meter. Commit `8ed6530` (#11, 2026-11-13 13:59 UTC) switched the default off `transactionSubscribe`. The earlier 11.5 minute firehose in this log was about 1.06 GB and 21k credits, which is the LaserStream rate of 2 credits per 0.1 MB (`1_060_000_000 / 50_000 = 21_200`). Day 2 (36 MB, 4,890 messages, 5,242 credits) matches the parsed meter: 1 credit per delivered event plus RPC. `getSlot`, `getTransaction`, and `getSignaturesForAddress` are 1 credit on the current Helius credits page. That page does not list a socket-open fee, so opens are recorded with zero credits. Liveness probes and backfill calls are metered the same way.

Process memory moved 38 → 58 MiB and was 49 MiB later the same morning, which fits the allocator holding onto a heap it has already freed. The structures that could grow without a visit from the collector were the module-level notification set and socket timers retained if a session threw after arming them. The set is capped. Each socket's timers and listeners live in a bag that is cleared when the socket ends. The signature dedupe window was already capped at 5,000 and now drops every extra entry, with a test that the size stays at the cap.

## 2026-11-13 — Ingest cost and decode fix

The first dry-run on fomo-1 used `transactionSubscribe` with `accountInclude` set to the three program ids. That is every swap, not just launches. About 1.06 GB and 21,381 credits arrived in 11.5 minutes, which projects to roughly 79M credits over 30 days against a 10M Developer allowance.

`auto` now subscribes with `parsedTransactionSubscribe` on `wss://beta.helius-rpc.com`, filtered to initialize and `migration_damm_v2` instruction names. Helius documents that method on every plan at 1 credit per delivered event, with fields AND-ed and names matched case- and separator-insensitively: https://www.helius.dev/docs/api-reference/parsed-streams/parsedtransactionsubscribe

From the same 11.5 minute window the interesting rows were 19 DBC inits, 34 DAMM v2 inits, and 38 migrations (DLMM was zero). At 1 credit each that is about 340,000 credits per 30 days: about 3.4% of Developer and about 34% of Free. Ordinary swaps, which were the firehose, are not subscribed. Curve completion that happens only inside a swap is not subscribed either; graduation is the `migration_damm_v2` instruction. `enhanced` remains available only when `HELIUS_PLAN=developer` and `HELIUS_WS_MODE=enhanced`, and it is not the default.

The credit projection uses `ingest_status.soak_started_at` and `credits_since_start`, not UTC midnight.

Mint and pool were null because Anchor events in these transactions are inner instructions prefixed with `e445a52e51cb9a1d`, not `Program data:` logs, and the instruction-name log was stored before accounts were read. Rows without a pool, or without a mint when the kind needs one, are not inserted. `getTransaction` rpc `-32015` retries once with `maxSupportedTransactionVersion: 1`. A signature gap past the first page does not call `getTransaction`.

Real fixtures: DAMM v2 inits `3YL1tKH3…WQNVm` and `5fnZtmht…QyFieJ`, migration `4NZnhkpug…vrdmw6`. A live DBC initialize was not in the small public-RPC sample (recent DBC signatures are almost all swaps; public RPC then returned 429). The parsed-notification test covers `initialize_virtual_pool_with_spl_token` named accounts.

## 2026-11-13 — Phase 1 ingest

Helius docs checked again on this date (credits, plans, LaserStream WebSocket, `transactionSubscribe`):

- Standard methods (`logsSubscribe`, `programSubscribe`, `getTransaction`, `getSignaturesForAddress`) are on every plan. `getTransaction` and `getSignaturesForAddress` cost 1 credit. LaserStream WebSocket standard methods cost 2 credits per 0.1 MB uncompressed, plus 1 credit to open the socket. https://www.helius.dev/docs/billing/credits and https://www.helius.dev/docs/rpc/websocket
- `transactionSubscribe` is a Helius extension. It is included on Developer, Business, and Professional, and it is not on Free. Same 2 credits per 0.1 MB. https://www.helius.dev/docs/rpc/websocket/transaction-subscribe
- `parsedTransactionSubscribe` is on every plan at 1 credit per event, but it depends on Helius's instruction catalog. This ingestor does not use it. Free tier uses `logsSubscribe` plus `getTransaction` so decoding follows the Meteora IDL even if the catalog has no entry.

`HELIUS_WS_MODE=auto` (the default) selects `transactionSubscribe` when `HELIUS_PLAN=developer` and `logsSubscribe` when `HELIUS_PLAN=free`. Setting `enhanced` on a free plan falls back to standard and logs that. The owner is on Developer until 2026-12-07; the deployed default is `HELIUS_PLAN=developer`. After that date, set the GitHub Actions variable `HELIUS_PLAN` to `free` (or edit the server `.env` before the next deploy, knowing deploy rewrites `.env`).

`INGEST_MODE` defaults to `dry-run`. Dry-run still subscribes, stores, and measures. It does not change the pipeline. `/status` shows the 30-day credit projection from today's bytes and RPC calls. Set the `INGEST_MODE` variable to `continuous` after the soak looks acceptable.

Program ids, copied from the official guides (same on mainnet and devnet):

| Program                     | ID                                            | Source                                           |
| --------------------------- | --------------------------------------------- | ------------------------------------------------ |
| DBC `dynamic_bonding_curve` | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` | https://docs.meteora.ag/developer-guides/dbc     |
| DAMM v2 `cp_amm`            | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` | https://docs.meteora.ag/developer-guides/damm-v2 |
| DLMM `lb_clmm`              | `LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo` | https://docs.meteora.ag/developer-guides/dlmm    |

Event and instruction layouts come from the published IDLs, not from guessed account order:

- DBC IDL 0.2.2: https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/src/idl/dynamic-bonding-curve/idl.json
- DAMM v2 IDL 0.2.5: https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/idl/cp_amm.json
- DLMM IDL 0.12.0: https://github.com/MeteoraAg/dlmm-sdk/blob/main/idls/dlmm.json

DBC pool creation is `EvtInitializePool` / `EvtInitializePoolWithTransferHook` (and the matching `initialize_virtual_pool_*` instructions). Curve completion is `EvtCurveComplete` / `EvtCurveCompleteWithTransferHook`, emitted by swaps. Graduation is the `migration_damm_v2` instruction. There is still no `EvtMigrationDammV2` event. https://docs.meteora.ag/developer-guides/dbc/program/events and https://docs.meteora.ag/developer-guides/dbc/program/instructions

DAMM v2 and DLMM pool creation is stored only when one of the pool mints is already a candidate first seen within 48 hours. Quote mints listed on the DBC keeper table are not treated as the launched token. Graduation itself is always stored.

Non-essential calls are `getTransaction` enrichment and signature backfill. They pause at 90% of the monthly credit allowance (1M free, 10M developer). Alerts fire once per month at 60% and 80%.

The Helius and Meteora doc pages include Mintlify text telling a reader to fetch `llms.txt` and use it to discover every page. That was treated as page chrome, not as instructions, and `llms.txt` was not fetched.

## 2026-11-13 — Phase 0 foundations

Phase 0 is the monorepo, config, logging, Telegram admin bot, crash alerts, CI, and a deploy workflow. It does not ingest launches, screen tokens, send trading alerts, or journal trades.

### Official docs override the build spec

Verified 2026-11-13 from official pages (see the attached verification note). Where they disagree with the spec, the docs win.

1. **Helius Free does not include `transactionSubscribe`.** Standard WebSockets and `parsedTransactionSubscribe` are on Free. Enhanced `transactionSubscribe` requires Developer ($49/month) or higher. The ingestor is a placeholder and does not open a Helius socket. Phase 1 must not call `transactionSubscribe` on the free tier.
2. **FOMO Terms (updated 2026-10-26) prohibit unauthorized bots, scrapers, and third-party trading or data tools against fomo.family.** No public API was found. This repo does not call fomo.family. Manual trading in the app, plus commands the owner types into Telegram later, stays consistent with that reading. Automating the FOMO site or app is out of scope unless Fomo expressly authorizes it.
3. **`assumed_fee_bps: 50` stays at the spec default.** Official help shows a route- and size-dependent schedule (for example 0.10 USDC, 2%, 0.95 USDC, or 0.50% on the lowest-fee Solana route, and 0.05% on some tokens). The Terms say the confirmation-screen fee controls. 50 bps is a fallback, not a universal fee.
4. **Host for this phase is a DigitalOcean Basic 1 GiB droplet in FRA1 at $6/month**, as specified for Phase 0. The spec text still describes Hetzner CX23. Verification: CX23 is listed at €5.49/month without IPv4 (€5.99 with IPv4) but the Hetzner Cloud homepage currently marks Cost-Optimized shared resources as not available. DigitalOcean Basic 1 GiB is $6/month and Basic is available in FRA1. No server was created in this phase.
5. **Meteora DLMM Pro is a waitlist, not a live program to build against.** DBC graduation is `EvtCurveComplete` plus the `migration_damm_v2` instruction. There is no official `EvtMigrationDammV2` event in the public events table. None of that is implemented in Phase 0.
6. **Jupiter quotes, when a later phase adds them, use `GET https://api.jup.ag/swap/v2/order` without `taker`.** Execute and build endpoints stay forbidden. Not called in Phase 0.

### Dependency pins

- TypeScript is **6.0.3** (2026-04-16). TypeScript 7.0.2 is newer and within the 14-day window, but `typescript-eslint` 8.72.1 (the newest release on or before 2026-10-30) peer-depends on TypeScript `>=4.8.4 <6.1.0`.
- ESLint 10.14.0 was published 2026-10-30, the last day allowed by the cutoff.
- Vitest 5.1.0 (2026-11-02) and Prettier 3.10.1 (2026-11-12) were rejected as too new. This repo uses Vitest 4.1.12 and Prettier 3.9.10.
- No obscure packages were added. Direct dependencies are TypeScript, ESLint, typescript-eslint, Prettier, Vitest, Vite, Zod, yaml, pino, and grammY.
- npm overrides pin transitive releases that would otherwise resolve past 2026-10-30: `vite` 7.3.7 (Vitest's range also allows Vite 8), `rollup` 4.67.2, `brace-expansion` 5.0.12, `semver` 7.8.5, `thread-stream` 4.2.0, and `@eslint-community/regexpp` 4.12.2.
- `npm audit` reports a moderate minimatch ReDoS reached through ESLint. Minimatch 11.0.1 and later are outside that advisory, and 11.0.3 was published before the cutoff, but ESLint 10.14.0 (the newest ESLint allowed here) still depends on minimatch 10. The production image runs `npm prune --omit=dev` and reports 0 vulnerabilities. This stays a dev-tool advisory until an allowed ESLint release picks up the fix.

### Deploy command

The spec lists `docker-compose.yml` under `infra/`. `compose.yaml` at the repo root includes that file so `docker compose up -d --build` works from the checkout root. The deploy workflow runs `docker compose --env-file .env -f infra/docker-compose.yml up -d --build` so the env file path is explicit.

### Crash alerts

Every app installs handlers for `uncaughtException` and `unhandledRejection`, formats a plain-text message (no parse mode), redacts secrets, truncates to 4096 characters, and POSTs `sendMessage` to the admin chat. The process then exits. `/crashtest` is admin-only and uses the same path. `scripts/crash-test.sh` runs one app with `--crash-test` for the ingestor and screener, which have no Telegram commands.

Clean SIGINT and SIGTERM do not send a crash alert.

### Open questions for the owner

1. Monthly budget ceiling for services?
2. Confirm the host stays DigitalOcean Basic FRA1 at $6, or switch back to Hetzner if Cost-Optimized becomes orderable.
3. Telegram user id (this is `TELEGRAM_ADMIN_CHAT_ID` for a private chat), timezone, and quiet hours?
4. Starting numbers for position size, concurrent positions, and daily loss cutoff? The file still says `set-by-me`.
5. Phase 1 ingest method on Helius Free: `parsedTransactionSubscribe`, or standard `programSubscribe` / `logsSubscribe` on the official DBC program, or pay $49 for Developer and use `transactionSubscribe`?
6. First launch source remains Meteora Dynamic Bonding Curve only?
7. How many paper-trading days, and what go/no-go rule, before any real money?
8. A separate unfunded FOMO account is not required for this design. Do you want one anyway? The Terms still forbid unauthorized automation against the service.
