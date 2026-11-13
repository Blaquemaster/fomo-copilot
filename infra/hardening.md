# Hardening notes

Phase 0 ships the posture below. Phase 7 in the build spec is not done.

## In place

- Compose publishes no host ports. Postgres is reachable only on the `fomo-copilot` Docker network.
- App containers run as the image `node` user, with a read-only root filesystem, `/tmp` on tmpfs, `no-new-privileges`, and all capabilities dropped.
- Postgres 16.14 is pinned by digest. Node 22.23.4 is pinned by digest in the Dockerfiles.
- Restart policy is `unless-stopped`. Memory limits are sized for a 1 GiB droplet (256 MiB for Postgres, 128 MiB for each app).
- The bootstrap script installs Docker from Docker's Ubuntu apt repository, creates a `deploy` user, locks that user's password, disables SSH password authentication, and sets ufw to deny inbound traffic except the current SSH port.
- Deploy writes `/opt/fomo-copilot/.env` as mode 600 from GitHub secrets. The file is gitignored.
- GitHub Actions deploy uses `StrictHostKeyChecking=yes` and a pinned `DEPLOY_KNOWN_HOSTS` secret.
- Logs are JSON to stdout, with secret redaction. Docker json-file logs are capped at 10 MiB times 3 files.

## Not done (Phase 7)

- SSH only over Tailscale, and a Hetzner or DigitalOcean cloud firewall with no public inbound ports.
- `PermitRootLogin no` after the owner has confirmed key login as `deploy`.
- Unattended security updates.
- Non-root is done for app containers; Postgres still starts as root inside its image and drops privileges itself.
- The `deploy` user is in the `docker` group. That group is root-equivalent on the host. A later phase can replace it with a narrower socket proxy.
- Nightly encrypted off-server backups and a restore test.
- Healthchecks.io ping every 5 minutes.
- Helius IP allow-list, once a Helius key is in use. Official docs support Allowed IPs and Allowed CIDRs for public addresses.
- Read-only GitHub deploy key is created by the bootstrap script; write access must stay off.

## Known supply-chain note

`node:22.23.4-bookworm-slim` is Node 22.23.4, released 2026-10-20. The digest pinned in the Dockerfiles was rebuilt on 2026-11-05 as an official Debian base refresh. Postgres `16.14-bookworm` was last published 2026-08-05. npm packages in the lockfile are pinned to releases published on or before 2026-10-30.
