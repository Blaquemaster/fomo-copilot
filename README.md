# FOMO Trading Copilot

Human-in-the-loop research and journaling for manual trading. Phase 0 is the foundation: a TypeScript monorepo, validated config, redacted logs, an admin-only Telegram bot, crash alerts, CI, and a deploy workflow.

This system does not place orders, sign transactions, hold wallets, or connect to fomo.family. It is research tooling. It does not guarantee profits and is not financial advice.

## Layout

```
apps/ingestor/     placeholder; no Helius connection in Phase 0
apps/screener/     placeholder; no screening in Phase 0
apps/alerter/      grammY long-polling bot (/ping, admin-only /crashtest)
packages/core/     config, logger, crash alerts
config/thresholds.yaml
infra/             compose file, droplet bootstrap, hardening notes
docs/              local development and the runbook
```

`compose.yaml` includes `infra/docker-compose.yml`, so `docker compose up -d --build` works from the repo root. No service publishes a host port.

## Local development

Requirements: Node 22.23.4 (see `.nvmrc`) and npm 10.9.9. Docker is only needed to run the stack.

```bash
cp .env.example .env
# Edit .env. Put your BotFather token and private chat id in it.
# Leave TELEGRAM_ADMIN_CHAT_ID as 0 only until you replace it; startup rejects 0.

npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

Run the alerter on the host (it does not need Postgres in Phase 0):

```bash
node --env-file=.env apps/alerter/dist/main.js
```

In Telegram, as the allow-listed chat, send `/ping`. The bot replies `pong`. Anyone else gets no reply.

Run the whole stack:

```bash
docker compose --env-file .env up -d --build
docker compose logs -f alerter
```

Force a crash alert:

```bash
scripts/crash-test.sh ingestor
```

or, in the admin chat, `/crashtest`. The process exits 1 after it sends the alert. Compose restarts a service that was started with `up`; `scripts/crash-test.sh` uses `compose run`, so it does not restart.

Details, GitHub secrets, and the droplet bootstrap are in [docs/runbook.md](docs/runbook.md). Conflicts with the build spec are in [docs/decisions.md](docs/decisions.md).

## Safety

- Do not commit `.env`. `.env.example` contains placeholders only.
- Logs and crash alerts redact passwords, tokens, API keys, and database URLs.
- The bot answers only `TELEGRAM_ADMIN_CHAT_ID`.
- Long polling only. No webhook and no inbound port.
