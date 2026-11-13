# Decision log

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
