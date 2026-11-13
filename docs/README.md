# Local development

Phase 0 can be built and tested on a laptop. Nothing in this phase calls Helius, Jupiter, DexScreener, RugCheck, or fomo.family.

## Requirements

- Node.js 22.23.4 and npm 10.9.9. `.nvmrc` pins the Node version. A newer Node 22 patch also works for local commands; CI and the Docker images use 22.23.4.
- A Telegram bot token from BotFather, and your numeric private chat id (the same value `@userinfobot` shows you).
- Docker Engine with Compose v2, only if you want to run the containers. `npm test` does not need Docker.

## First run

From the repository root:

```bash
cp .env.example .env
```

Edit `.env`:

- `TELEGRAM_BOT_TOKEN`: the token from BotFather.
- `TELEGRAM_ADMIN_CHAT_ID`: your private chat id. `0` is rejected so a copied example cannot boot.
- `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL`.
- `HELIUS_API_KEY`: any placeholder of at least 8 characters is enough in Phase 0. The ingestor does not call Helius.

Then:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
```

`npm test` covers the thresholds file, env validation (including that rejected secrets are not copied into the error text), log redaction, the admin allow-list, `/ping` and `/crashtest` decisions, and crash-alert formatting.

## Run the bot without Docker

```bash
node --env-file=.env apps/alerter/dist/main.js
```

The process uses long polling. It deletes any webhook on startup and drops pending updates, so an old `/crashtest` cannot crash-loop the bot. Send `/ping` from the allow-listed chat. You should get `pong`. Send `/ping` from another account. You should get nothing.

Stop it with Ctrl-C. That is a normal shutdown and does not send a crash alert.

## Run the stack

```bash
docker compose --env-file .env up -d --build
docker compose ps
docker compose logs alerter
```

Postgres is not published on the host. From the host:

```bash
docker compose exec postgres psql -U fomo -d fomo
```

The ingestor and screener log a placeholder line and then a heartbeat every five minutes. They do not open a Helius socket.

## Crash alert

Admin chat:

```text
/crashtest
```

Or, for any app:

```bash
scripts/crash-test.sh screener
```

Without Docker, after a build:

```bash
node --env-file=.env apps/ingestor/dist/main.js --crash-test
```

The process exits 1. The private chat should receive a message that starts with `FOMO copilot crash`, names the app, and does not contain the bot token or database password. If the token is missing or rejected by Telegram, the process still exits and the failure is logged without the token.

## Config

`config/thresholds.yaml` is the Section 7 default file. Apps refuse to start when it does not match the Zod schema. Risk sizes are the string `set-by-me` until you replace them with numbers. `required_source_error` can only be `WATCH`.

Do not commit `.env`.
