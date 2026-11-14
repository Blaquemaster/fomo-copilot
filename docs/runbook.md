# Runbook

Phase 0 deploys to a DigitalOcean Basic droplet you create yourself: 1 GiB RAM, 1 vCPU, 25 GiB SSD, 1,000 GiB transfer, FRA1, Ubuntu 24.04 LTS, $6.00/month. No droplet was created while this phase was built. Cost of the build itself: $0.

Helius is not called yet. Leave the key on the free plan until Phase 1 is designed. Free does not include `transactionSubscribe` (Developer is $49/month). See [decisions.md](decisions.md).

## GitHub secrets

Add these in the repository Settings, Secrets and variables, Actions. Names must match. Values stay in GitHub; they are written to `/opt/fomo-copilot/.env` on the server at deploy time and are not committed.

| Secret                   | What to put                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `DEPLOY_SSH_KEY`         | Private half of the key GitHub Actions uses to SSH to the droplet. Include the `BEGIN` and `END` lines. |
| `DEPLOY_HOST`            | Droplet public IPv4 or DNS name.                                                                        |
| `DEPLOY_USER`            | `deploy`                                                                                                |
| `DEPLOY_KNOWN_HOSTS`     | One or more lines from `ssh-keyscan -t ed25519` of the droplet.                                         |
| `TELEGRAM_BOT_TOKEN`     | Token from BotFather.                                                                                   |
| `TELEGRAM_ADMIN_CHAT_ID` | Your private Telegram chat id (positive integer).                                                       |
| `HELIUS_API_KEY`         | Helius key. Unused in Phase 0, required so the env file is complete.                                    |
| `POSTGRES_PASSWORD`      | Database password, at least 8 characters. The workflow sets the user and database name to `fomo`.       |

Also turn on secret scanning and push protection in the repository security settings, if the plan allows it. Dependabot is configured in `.github/dependabot.yml`.

Recommended branch protection on `main`: require a pull request and the CI workflow. The agent does not merge.

## 1. Create the SSH key Actions will use

On your own computer, not on the droplet and not in the agent environment:

```bash
ssh-keygen -t ed25519 -f fomo-actions -C "github-actions-deploy" -N ""
```

- The contents of `fomo-actions` go into `DEPLOY_SSH_KEY`.
- `fomo-actions.pub` is passed to the bootstrap script.
- Do not commit either file.

## 2. Create the droplet

In the DigitalOcean control panel:

- Image: Ubuntu 24.04 LTS.
- Plan: Basic, 1 GiB / 1 vCPU, $6/month.
- Region: Frankfurt (FRA1).
- Authentication: your personal SSH key. Do not enable password login.
- No extra volumes and no reserved IP unless you want them. A reserved IP is optional and billed separately.

Note the public IPv4.

## 3. Bootstrap the droplet

SSH in as root with the key you attached in the DigitalOcean panel, copy this repository onto the machine (a temporary clone as root is fine), and run:

```bash
sudo bash infra/bootstrap-droplet.sh --i-understand \
  --authorized-key "ssh-ed25519 AAAA... your-personal-key" \
  --authorized-key "ssh-ed25519 AAAA... fomo-actions.pub"
```

The script:

- upgrades apt packages and installs Docker Engine from Docker's Ubuntu repository;
- creates a 1 GiB swap file (the $6 droplet has 1 GiB of RAM);
- creates user `deploy`, locks its password, and adds it to the `docker` group;
- installs the public keys you passed into `/home/deploy/.ssh/authorized_keys`;
- generates `/home/deploy/.ssh/github_deploy` and prints the public key;
- disables SSH password authentication (root key login stays on until Phase 7);
- sets ufw to deny all inbound traffic except the current SSH port.

Before you close the root session, open a second terminal and check:

```bash
ssh -i ~/.ssh/your_key deploy@DROPLET_IP
```

## 4. GitHub deploy key and clone

The script prints a public key labeled as the GitHub read-only deploy key.

1. Repository Settings, Deploy keys, Add deploy key.
2. Paste that public key.
3. Leave **Allow write access** unchecked.
4. On the droplet, as root:

```bash
sudo bash infra/bootstrap-droplet.sh --i-understand \
  --authorized-key "ssh-ed25519 AAAA... your-personal-key" \
  --authorized-key "ssh-ed25519 AAAA... fomo-actions.pub" \
  --repo git@github.com:OWNER/fomo-copilot.git
```

Re-running is safe. It will not replace an existing GitHub deploy key or an existing checkout. The clone lands at `/opt/fomo-copilot` on `main`.

## 5. Pin the host key

On your computer:

```bash
ssh-keyscan -t ed25519 DROPLET_IP
```

Compare the fingerprint with the DigitalOcean console (or with `ssh-keygen -lf` against a key you already trust). Put the `ssh-keyscan` line into `DEPLOY_KNOWN_HOSTS`. The deploy workflow refuses to connect if this secret does not look like a host key, and it sets `StrictHostKeyChecking=yes`.

## 6. First deploy

Merging to `main` starts `.github/workflows/deploy.yml`. If any secret above is missing, the job skips, prints the missing names, and does not open an SSH connection. After you add the secrets, re-run that workflow from the Actions tab.

When the secrets are present the job:

1. Builds `/opt/fomo-copilot/.env` on the runner (mode 600) and uploads it.
2. SSHes as `deploy` and `git pull --ff-only`s `main` with the server's GitHub deploy key.
3. Moves the env file into place (`chmod 600`).
4. Runs `docker compose --env-file .env -f infra/docker-compose.yml up -d --build`.

Watch the run. A failed SSH or a failed compose build fails the job. A missing secret does not.

On the server:

```bash
cd /opt/fomo-copilot
docker compose --env-file .env -f infra/docker-compose.yml ps
docker compose --env-file .env -f infra/docker-compose.yml logs alerter
```

## Ingest (Phase 1)

No new GitHub secrets. `HELIUS_API_KEY` is already written into the server `.env`.

Optional GitHub Actions **variables** (Settings → Secrets and variables → Actions → Variables), not secrets:

| Variable         | Default if unset | Values                                                                                            |
| ---------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `HELIUS_PLAN`    | `developer`      | `developer` or `free`. Set `free` on 2026-12-07 unless the Developer plan is renewed.             |
| `HELIUS_WS_MODE` | `auto`           | `auto` and `standard` use the filtered parsed stream. `enhanced` is the full-program firehose.    |
| `INGEST_MODE`    | `dry-run`        | `dry-run` or `continuous`. Dry-run still stores events. Leave it on dry-run for the 24 hour soak. |

The next deploy starts the ingestor on the filtered stream. That is safe to leave running. On the server:

```bash
cd /opt/fomo-copilot
docker compose --env-file .env -f infra/docker-compose.yml logs -f ingestor
docker compose --env-file .env -f infra/docker-compose.yml exec -T ingestor \
  node apps/ingestor/dist/main.js --spot-check
```

In the admin chat, `/status` shows connection state, events today, bytes today, and the 30-day credit projection. `/events` prints recent rows with Solscan links. A laptop with `.env` can run `scripts/spot-check-events.sh` after `npm run build`.

Leave it for 24 hours. Then spot-check 20 signatures on Solscan, read the projection, and only then set `INGEST_MODE` to `continuous` if the credit estimate is acceptable. A quiet program does not reconnect the socket. The ingestor treats the socket as dead only when slot notifications and ping replies both stop: it logs a warning, sends one `getSlot` probe, and reconnects if that stays unanswered. Telegram fires when a reconnect fails to open, not for a routine reconnect that succeeds. Non-essential RPC pauses at 90% of the monthly allowance. Parsed stream events are metered at 1 credit each. `getSlot`, `getTransaction`, and `getSignaturesForAddress` are metered at 1 credit per call, including backfill and liveness probes.

## Host healthcheck

Bootstrap installs `infra/fomo-healthcheck.sh` to `/usr/local/bin/fomo-healthcheck.sh` and `infra/fomo-healthcheck.cron` to `/etc/cron.d/fomo-healthcheck` (every 5 minutes as root). The script sources `/etc/fomo-healthcheck.env` for `HC_URL` and an optional `BASE_RESTARTS`.

Create that env file on the server yourself. Do not commit it and do not paste the URL into the repo, a log, or a pull request:

```bash
sudo install -m 0600 -o root -g root /dev/null /etc/fomo-healthcheck.env
sudoedit /etc/fomo-healthcheck.env
```

The file mode stays `0600` and the owner stays `root:root`. The cron line appends to `/var/log/fomo-healthcheck.log`.

## 7. Test /ping

From your phone, open the bot and send:

```text
/ping
```

Expected reply: `pong`.

Send `/ping` from a different Telegram account. Expected: no reply. The alerter log shows `ignored telegram update` with reason `not-allowlisted` and does not log the message text.

## 8. Test the crash alert

In the admin chat:

```text
/crashtest
```

Expected:

1. The bot replies that a crash test was triggered.
2. A second message arrives, starting with `FOMO copilot crash`, with `app: alerter` and `kind: crash_test`.
3. The alerter container restarts (`restart: unless-stopped`) and `/ping` works again.

Pending updates are dropped on startup so a replayed `/crashtest` does not loop.

For the other apps, on the server:

```bash
cd /opt/fomo-copilot
scripts/crash-test.sh ingestor
scripts/crash-test.sh screener
```

Each command is expected to exit 0 after the app exits 1. The admin chat gets one alert per command. `compose run` does not leave a restart loop.

A normal `docker compose stop` sends SIGTERM and does not alert.

## If deploy keeps skipping

The notice in the Actions log lists the secret names that are empty. GitHub never shows the values. Fix the secrets and re-run. The workflow does not create the droplet and does not have a fallback host.

## If the bot does not answer

- `TELEGRAM_ADMIN_CHAT_ID` must be the private chat id, not a phone number and not a `@username`.
- The token must be the current BotFather token.
- `docker compose logs alerter` should show `alerter long polling started`. A 401 means the token was rejected. The log must not contain the token; if it does, treat that as a bug.
- The host needs outbound HTTPS to `api.telegram.org`. It does not need an inbound port.

## What you still do by hand

- Create the DigitalOcean droplet, the Helius account, and the Telegram bot.
- Pay for the droplet when you are ready ($6/month). This phase did not start that bill.
- Merge pull requests. The deploy key cannot push.
- Phase 7 items in [../infra/hardening.md](../infra/hardening.md): Tailscale-only SSH, turn off root login, unattended upgrades, backups, and the Helius IP allow-list. The healthcheck cron is installed; you still create its env file on the host.
