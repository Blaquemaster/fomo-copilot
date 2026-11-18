# Decision log

## 2026-11-18 — Early-buyer backfill and a daily wallet refresh

`PUMP_SUBSCRIBE_TRADES` stays off, so `pump_trade` does not fill the proven-wallet list. A backfill reads each mint's oldest transactions with `getTransactionsForAddress` (`sortOrder: asc`, `transactionDetails: full`, limit 100, succeeded only). That is 10 credits per 100 transactions returned, and it can start at the first transaction. `getSignaturesForAddress` is newest-first, so reaching the same early buys would walk the whole curve and then cost one `getTransaction` per signature.

The job takes mints that graduated (`pump_migrate`, `launchlab_migrate`, `dbc_migration_damm_v2`) first, then the same number of non-graduated mints for the loss side. It keeps the first `WALLET_BACKFILL_BUYS` non-creator buys (default 50) and the sells in that same window. Pump buys come from the existing buy/sell layouts. LaunchLab uses `buy_exact_in`, `buy_exact_out`, `sell_exact_in`, and `sell_exact_out` on the pool. Meteora DBC swaps are kept only when the payer's base-token balance shows the direction. A mint stops after 3 pages. Rows land in `wallet_early_buy` and are ignored if the same signature, index, and wallet are inserted again. `wallet_backfill_mint` stores the page token, so a stopped run continues. Spend is `wallet_backfill` in `ingest_feature_daily` and in the month total.

`WALLET_BACKFILL_CREDIT_CAP` is 200,000 credits a month. `WALLET_BACKFILL_RUN_CREDITS` is 10,000 per run. One page is the common case, so 200,000 credits covers 20,000 mints, and the 3-page worst case covers about 6,600. That is the one-time ceiling for the first month; the cursor resumes after it. The last measured Pump graduation rate was about 54 an hour, about 1,300 a day. A matching loss sample is about 2,600 mints a day, about 26,000 credits a day, about 780,000 a month. The default cap does not cover that. It allows about 6,700 credits a day, about 670 mints a day, and leaves a backlog until the cap is raised.

The wallet list is no longer frozen. Once a day the scored list is applied. An empty list may fill to `WALLET_MAX_WALLETS`. After that, at most `WALLET_CHURN_PCT` (default 20, 60 of 300) of the current addresses are replaced. Empty slots under 300 may still be filled. The Helius subscription picks up the new addresses on the next websocket connect.

Helius Developer is confirmed at 10,000,000 credits a month, with overage at $5 per million. `HELIUS_MONTHLY_CREDITS` defaults to that. Create and graduation intake and its gap backfill pause only at 90 percent of 10,000,000 (or of a larger configured allowance). A smaller value cannot pause them. The wallet subscription cap is 25 percent of the configured allowance: 2,500,000 credits a month at 10,000,000. That cap unsubscribes the wallet filters on the open socket as soon as `wallet_subscribe` reaches it. The status report prints spent, cap, and open or stopped. A daily refresh replaces the live subscription in the same connection. Wallet trades are stored in `wallet_fill` and are not written to `raw_events`. `X_MENTION_SOURCE` defaults to `off`, and a fixture is never stored when `NODE_ENV` is production.

## 2026-11-18 — Phase B wallet signal, dry-run

The first proven-wallet list is built from stored history, before any Phase D window exists. A winner is a mint with a stored graduation (`pump_migrate`, `launchlab_migrate`, or `dbc_migration_damm_v2`). An early buy is a non-creator buy or sell already in `pump_trade`. Lookback is all of that stored history. A wallet needs at least two distinct early buys and at least one early win. It is dropped when its early sells of winners are at least its early wins. Rank is hit rate, then early wins, then address. The cap is `WALLET_MAX_WALLETS`, default 300. Funding source is unknown, so each address counts once and that limit is in the derivation note. LaunchLab and Meteora have no per-trade buyer rows yet, so selection uses `pump_trade` only. An empty table stays empty. No addresses are invented.

The first build of this list was not replaced automatically. That freeze is lifted by the early-buyer backfill entry above: the list refreshes daily with a 20 percent churn cap.

The subscription is parsed transactions whose program is Pump, PumpSwap, LaunchLab, Meteora DBC, or DAMM v2, whose instruction is a trade name, and whose accounts include one of the selected wallets. Helius ANDs those filters. `accounts.include` holds at most 100 addresses, so 300 wallets are three subscriptions on the existing socket. The lifecycle subscription stays creates and graduations. Wallet notifications are metered as `wallet_subscribe` in `ingest_feature_daily` and are not also added to a venue's stream credits. They do count in the month total, because Helius charges them. Parsed delivery is 1 credit per event. The hard stop is `WALLET_CREDIT_BUDGET_PCT`, default 25 percent of `HELIUS_MONTHLY_CREDITS`. That allowance defaults to 1,000,000 until the plan is confirmed, so the wallet cap defaults to 250,000 credits a month. A connect past the cap does not resubscribe. Credits already delivered on an open socket are spent. BSC wallets are later.

A fill is stored when a tracked wallet is a named account on that trade and a non-quote mint is named. Buy and sell come from the instruction name. `swap` stays undirected. `coin_wallet_signal` counts buyers, buys, and sells per mint. This is dry-run. No Telegram alert is sent for a fill.

X mentions use `XMentionSource`. The repo source is the fixture in `packages/core/src/ingest/fixtures/x-mentions.json`. An empty query returns that sample. There is no Scout file and no call to X. Live search is a later plug on the bot. Handles are stripped to letters, digits, and underscore. Mention rows are stored. No Telegram alert is sent for a mention.

## 2026-11-18 — Flap reconnects and catch-up

`BSC_WSS_URL` defaults to `wss://bsc-rpc.publicnode.com`. That URL has no API key, so deploy always writes it and logs do not treat it as a secret. A keyed override still comes from the Actions variable or secret.

Each connect subscribes before `eth_getLogs`. Catch-up starts at the last saved block, inclusive, and walks the whole gap in pages of 500. A failed page is logged and retried. The checkpoint moves only after a page is stored. Duplicate logs are ignored by `(tx_hash, log_index)`.

PublicNode closes the socket every few minutes. A 20 second ping and `eth_blockNumber` keep it up, and each reconnect increments `ingest_chain_checkpoint.reconnects`, which the status report prints.

`getTokenV8Safe` is retried at 30 seconds, 2 minutes, and 10 minutes when the create-time read comes back empty. The six-hour recall covers about the last hour of BSC blocks, paged, and records expected, matched, and missed for the chain.

The Meteora coin cleanup from `014_launchpad_tags` runs once. `raw_events (mint, event_kind)` is indexed for that query.

## 2026-11-18 — BNB Chain Flap, beside Solana

Flap creates and graduations are read from the BNB Chain Portal `0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0`. The socket subscribes to `TokenCreated`, `FlapTokenTaxSet`, `LaunchedToDEX`, and `FlapTokenCLPoolCreated`. Trades are not subscribed. `getTokenV8Safe` runs once per create. Coins are stored in `ingest_asset` with primary key `(chain, address)` and launchpad `Flap`, including the tax rate. Checkpoints are block numbers in `ingest_chain_checkpoint`. A reconnect catch-up is one `eth_getLogs` of at most 500 blocks. A wider gap is left unrecovered so a public RPC range limit is not walked. A recall every six hours compares one 200-block window with `eth_getLogs`.

The BSC loop catches its own errors and does not stop the Helius loop. GoPlus and Honeypot.is request URLs exist as `flapScreenRequests` and are not called.

Alchemy's free tier is about 30 million compute units a month. This path is one logs subscription, one `eth_call` (26 CU) per create, and one `eth_getLogs` (60 CU) per recall. At a few hundred Flap creates an hour that is a few million CU a month. The live topic hash was not confirmed against a BSC node; public `eth_getLogs` was rejected. The topics are keccak256 of the signatures in the Flap indexer doc.

## 2026-11-18 — Launchpad display names

FOMO's display names used here are `Pump.fun`, `BONK.fun`, `StonkFun`, and `Raydium Launchlab`. Existing `ingest_coin` rows are updated on migrate. Raydium's own platform `4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4` is tagged `Raydium Launchlab` (on-chain name `Raydium`, site raydium.io, the SDK's default platform id).

The three common unknown LaunchLab configs are not BONK.fun. `2TDPJJPV6nvTEqXABxrqno6Uzpipxxvh1zjLN3SMYn69` is Float (`floatlaunch.xyz`). `CB6mNV9YCH21gDD97CcEgc3sGNZxnLA6ymYx8fNsKbKY` is named `My Launch Platform`. `2RN8d2W5YBZFq8PcQvgcX9t8jKzgZcjiyxvYSkk4CadN` has an empty name. None of those names are on FOMO's list, so they stay `unknown` with the config id stored. Bags, Believe, and Jupiter Studio still have no published stable DBC config list.

A DAMM v2 initialize is not a new Meteora launch. `ingest_coin` is written for DBC creates and DBC migrations only, and migrate deletes Meteora coin rows that have neither. The stale DLMM checkpoint is deleted on migrate and on each startup. Per-venue `stored_events` is incremented when an event for that venue is stored, not left at 0.

## 2026-11-18 — Pump, LaunchLab, and Meteora run together

`INGEST_VENUES` replaces the single-venue switch. When it is unset, `INGEST_VENUE` still selects one venue. Production sets `pump,launchlab,meteora`. Each venue has its own coverage row in `ingest_venue_coverage` and its own recall total. A venue with no coverage row starts at the tip and its old checkpoints are deleted, so Meteora does not walk the gap from the November 17 shutdown. Pump coverage copied from the old singleton is kept.

LaunchLab subscribes to creates and graduations only (`initialize`, `initialize_v2`, `initialize_with_token_2022`, `migrate_to_cpswap`, `migrate_to_amm`). Platform tags come from the platform config account: StonkFun and Bonk ids were checked on-chain (the account name is `StonkFun` or `letsbonk.fun`). Any other config is `unknown` and the config id is stored. The Token-2022 transfer-fee rate is read from the create instruction when it is present. Meteora DBC and DAMM v2 are subscribed again. DLMM is not, because it is not a launch. Bags, Believe, and Jupiter Studio do not publish a stable DBC config list, so those coins stay `unknown` with the config id stored. Stream credits are also written per venue to `ingest_venue_daily`. A public-RPC sample of LaunchLab on 2026-11-18 was about 1.6 transactions per second, and 3 of 39 sampled transactions were a create or a graduation, roughly 400 stream credits an hour. The last measured Meteora window (11.5 minutes, before the shutdown) was 19 DBC creates, 34 DAMM v2 creates, and 38 migrations, about 470 credits an hour with DLMM at zero. Both are samples, not a soak.

## 2026-11-17 — Backfill only subscribed programs

Startup backfill used every program for the venue, so PumpSwap was scanned even with `PUMP_SUBSCRIBE_CREATE_POOL=false`. That walk burned about 440 credits on a 38-slot gap and left the checkpoint at slot 470531229. Backfill now uses the same filter as the websocket, and a checkpoint for a program that is not subscribed is deleted. A similar 38-slot restart of the Pump program is one scan of about 3,000 transactions, about 13 credits, plus one `getTransaction` per create or migrate in the gap.

Audit windows are chosen only from slots at or after `coverage_slot`, so a useful 5-minute window exists about 35 minutes after coverage starts instead of waiting until the whole 6-hour horizon is inside coverage. Rows whose window starts before coverage, or whose program is not in the current venue, are marked `skipped` on migrate (`012_skip_stale_audits`). Recall totals and creation-unseen follow the same scope, so the old Meteora gaps and the pre-coverage Pump misses stay out of the 7-day alert.

## 2026-11-17 — Coverage, create_pool, and a cheaper audit

The first Pump audit scored chain history from before the venue switch as 471 misses. A window that ends at or before `ingest_status.coverage_slot` is stored as `skipped` with reason `before_coverage` and does not page Telegram. A window that straddles coverage is scanned only from that slot forward. Coverage resets when the stored venue changes, when a slot with no venue is already older than the backfill cap (the leftover Meteora checkpoint), or when the same venue's slot is too old to backfill. A usable slot for the current venue is kept.

PumpSwap `create_pool` outside a Pump `migrate` is not a Pump.fun graduation. The live subscription and the audit omit it unless `PUMP_SUBSCRIBE_CREATE_POOL=true`. A `create_pool` instruction inside a migrate transaction is still decoded. Measured production was about 173 of those events an hour, so dropping them takes the stream from about 1,253 credits an hour (about 902k a month) to about 1,080 an hour (about 778k a month). Creates plus migrates are about 1,100 an hour by themselves, so that is the floor. It is under the Free plan's 1 million and about 28k above a 750k target. The 60/80/90 percent guards are unchanged.

The Pump recall window is five minutes, not fifteen. At about 200 transactions a second, fifteen minutes is about 180,000 transactions and does not finish inside eight scan pages (the 160 credit cap). Five minutes is about 60,000 transactions, six pages, about 120 credits, and it finishes. Four runs a day is about 14k credits a month, under the 40k audit budget. PumpSwap is not scanned while `create_pool` is off.

## 2026-11-17 — Pump.fun is the live venue

Meteora stays in the code and turns on with `INGEST_VENUE=meteora`. The default is `pump`: program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` and PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`, both read from the address field of the official IDLs in https://github.com/pump-fun/pump-public-docs. The live subscription always includes create, create_v2, migrate, migrate_v2, and create_pool. Buy and sell names are added only when `PUMP_SUBSCRIBE_TRADES=true`. The recall scan stays on the lifecycle names, the same split PR #17 used for the transfer-hook instruction.

Every create and graduation is stored. A trade is stored as its own row for `PUMP_TRADE_DETAIL_SLOTS` (150, about a minute) after that coin's create, and whenever the trader is the create signer. Later trades of a known coin update `pump_coin_stats` only. Trades for a coin we never saw created are not stored. A public-RPC sample on 2026-11-17 showed about 200 Pump.fun transactions per second and about 200 PumpSwap transactions per second. Subscribing to the trade names would be on the order of 200,000 parsed events an hour, about 150 million credits a month. That does not fit the Free plan's 1 million credits, or a 10 million Developer plan. Creates alone are roughly one million credits a month and are the default. Slot notifications were not the metered part of the previous soak (about 324 credits an hour against thousands of slot messages an hour).

Slot gaps of one slot were counted as soon as a higher slot arrived, so a notification that showed up a couple of slots late looked like a drop. Gaps are now counted only after 16 later slots, and only if the missing slot never arrived. Slots the leader never produced still look like gaps; a 500-slot public sample was missing 3 blocks, while the soak's 101 gaps across 411k slots is far below that skip rate, so most of those 101 were reorder or a restart, not Solana skipping blocks.

## 2026-11-16 — Scan names are not the live subscription names

Helius's parsed-events scan returns HTTP 400 when the DBC filter includes `initialize_virtual_pool_with_token2022_transfer_hook`, because that name is not in the IDL it scans. The live subscription still sends it. Startup backfill and the recall audit scan `DBC_SCAN_INSTRUCTION_NAMES`, which omits that name. A scan that still fails is recorded on `ingest_recall_audit` as `errored` with `error_reason` (`009_recall_error`). The audit continues with the other programs and sends one summary, instead of exiting and raising a crash alert.

## 2026-11-16 — Queue the transactions, count the drops, audit a sample

The 24h re-soak missed 2 of 214 sampled DBC launches. The handler did a database write for every slot notification, and a third frame that arrived while one was in flight and one was waiting was discarded with no log. Slot notifications and ping replies now update liveness in the socket callback and are not queued. Only transaction frames are queued, up to about 8 MB. Past that, the slot and signature are held in a bounded memory log and written to `ingest_backfill` with reason `queue_overflow` after the database accepts a flush, which runs the same instruction scan. A frame over 100 KB is fetched with `getTransaction` when its signature can be read. `ingest_frame_hourly` records received, queued, and dropped frames, handler time, slot gaps, and a shadow count of frames the old two-deep queue would have dropped.

Usage counters flush every 15 seconds in one transaction. Each stored event writes its raw row, candidate, and checkpoint in one transaction. The ingestor's Postgres connections set `synchronous_commit=off`. The budget read is cached for 60 seconds. A subscribe error, or no confirmation within 10 seconds, alerts and reconnects. Liveness ignores slot progress until the transaction subscription is confirmed.

The recall audit is a one-shot `audit` Compose service, not a loop inside the ingestor. Cron runs one 15-minute window per program every 6 hours. Misses are stored with `source=audit` and `first_seen_at` from the chain block time. Those rows stay out of `alertable` candidate reads. There is no paper-trade writer yet; that filter is the gate. The transfer-hook initialize is counted from stored rows. The scan rejects that instruction name, so there is no daily hook scan.

## 2026-11-14 — Parsed history scan for high-volume programs

An 82-slot deploy gap recovered DBC (134 transactions, 3 events) and then hit the 400-transaction startup cap on DAMM v2 (1,495 signatures listed, 399 fetched) and DLMM (1,992 listed, 400 fetched). Those programs list about 13–20 signatures per slot, almost all swaps. The restart spent about 1,290 credits and stored no DAMM or DLMM events.

Helius Parsed Events scan (`POST /v1/parsed-events/scan`, documented at https://www.helius.dev/docs/api-reference/parsed-events/scan) walks one address in pages of 1,000 transactions and keeps only the instruction names we send. It is on every plan. The charge is 10 credits per request plus 1 credit per page scanned, returned as `scan.creditsCharged`. The same 82-slot window is 11 + 12 + 12 = 35 scan credits, plus one `getTransaction` per matched initialize. `getTransactionsForAddress` can bound by slot but cannot filter by instruction name, so it would still return the swaps. The DBC event authority also appears on swaps, so listing a narrower account does not isolate initializes.

When a restart or reconnect has a live slot, all three programs scan their initialize and migration names with `slot.gt` at the margin-adjusted live slot. DBC names are the three virtual-pool initializes plus `migration_damm_v2`. DAMM v2 names are `initialize_pool`, `initialize_customizable_pool`, and `initialize_pool_with_dynamic_config`. DLMM names are `initialize_lb_pair`, `initialize_lb_pair2`, and the two customizable permissionless pair names. If the scan request fails, DAMM v2 and DLMM record `reason = high_volume_skipped` and do not fall back to fetching hundreds of swaps. DBC falls back to the signature walk, which already covered its 134-transaction window. `dbc_curve_complete` from a Swap2 is still filled when that full transaction is decoded. The live subscription does not include swap or swap2, so the scan does not look for them either.

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
