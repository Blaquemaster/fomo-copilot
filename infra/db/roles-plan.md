# Database roles and the read-only audit user

**DO NOT APPLY.** Nothing in this directory is run by application startup, compose, or CI.
Applying it needs a separate approval. The live ingestor is the only service running.

## What this would change

- `fomo_ingestor` can insert into `raw_events` and cannot update, delete, or truncate it.
- `fomo_screener` can read ingest tables and write the `phasec_*` tables.
- `fomo_alerter` can read alerts and set `delivered_at`.
- `fomo_audit` is read-only via `pg_read_all_data`, with the session forced read-only.
- `fomo_migrator` is the only role that would change the schema.
- An OS user `fomo-audit` would reach the database and logs only through two root-owned wrappers.

Passwords are not in this repo. The SQL says `<set out of band>`.

## Rollout

1. Take a database dump. Keep the current `DATABASE_URL` until the new roles have been tested.
2. As the database superuser, review `infra/db/roles.sql`, substitute the database name, and set passwords out of band. Run the file once.
3. Add `local all fomo_audit scram-sha-256` above the `trust` line in `pg_hba.conf`. Reload Postgres. Do not leave local trust as the path the audit user uses.
4. Point a scratch `DATABASE_URL` at `fomo_ingestor` and confirm `insert into raw_events` works and `update raw_events` fails with SQLSTATE `42501`.
5. Repeat for the screener (a `phasec_*` write works, a `raw_events` write fails) and the audit role (a `select` works, any write fails).
6. Create the OS user and install the wrappers below. Confirm `sudo -l` lists only those two commands.
7. Only after those checks, change each service's `DATABASE_URL` and restart that service. Restart the ingestor last, and only with an explicit approval, because a restart can lose launches.

## Rollback

1. Point every service `DATABASE_URL` back at the previous superuser URL and restart.
2. `DROP OWNED BY` each new role, then `DROP ROLE` for `fomo_ingestor`, `fomo_screener`, `fomo_alerter`, `fomo_audit`, and `fomo_migrator`.
3. Remove the `fomo_audit` `pg_hba` line and reload Postgres.
4. Delete `/usr/local/sbin/fomo-ro-psql`, `/usr/local/sbin/fomo-ro-logs`, and `/etc/sudoers.d/fomo-audit`.
5. `userdel fomo-audit`. Leave the existing admin key in place until this rollback is finished.

## OS user

This matches the round-2 Q11 write-up. It is not installed by this pull request.

1. `useradd -m -s /bin/bash fomo-audit`. The user is not in `docker` or `sudo`.
2. `authorized_keys` holds a new key, prefixed `restrict,no-port-forwarding,no-agent-forwarding,no-X11-forwarding`.
3. Install the two wrappers from `infra/audit/` as root-owned `0755` files in `/usr/local/sbin/`.
4. Sudoers `/etc/sudoers.d/fomo-audit` mode `0440`: `fomo-audit ALL=(root) NOPASSWD: /usr/local/sbin/fomo-ro-psql, /usr/local/sbin/fomo-ro-logs`.
5. After setup, `docker ps` is denied, `cat /opt/fomo-copilot/.env` is denied, and `echo "update raw_events set source=source where false" | sudo fomo-ro-psql` returns permission denied.
