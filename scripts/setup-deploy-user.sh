#!/usr/bin/env bash
# One-time root bootstrap. Idempotent. Does not remove root or any existing admin login.
# Exact changes:
#   useradd fomo-deploy if missing, shell /bin/bash, not a member of the docker group
#   passwd -l fomo-deploy
#   authorized_keys replaced from the supplied public key
#   sshd Match for fomo-deploy disables password login for that user only
#   /usr/local/lib/fomo/fomo-deploy-helper installed root:root mode 755
#   rollback sources, preflight, and cutover report copied to root-owned paths
#   /etc/fomo/docker-compose.yml and deploy-authorization.json installed root:root mode 644
#   sudoers allows only that helper
#   /home/fomo-deploy/backups created
# Unchanged: root's account, root's authorized_keys, other users, the docker socket mode.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "one-time: create deploy user is the only root step" >&2
  exit 1
fi

key_src=${1:-}
if [[ -z "$key_src" || ! -f "$key_src" ]]; then
  echo "usage: sudo bash scripts/setup-deploy-user.sh /path/to/existing-key.pub" >&2
  exit 1
fi
if ! grep -Eq '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-) ' "$key_src"; then
  echo "authorized_keys source is not a public key" >&2
  exit 1
fi

root_keys=""
if [[ -f /root/.ssh/authorized_keys ]]; then
  root_keys=$(sha256sum /root/.ssh/authorized_keys | awk '{print $1}')
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(cd "$script_dir/.." && pwd)

if id fomo-deploy >/dev/null 2>&1; then
  usermod -s /bin/bash fomo-deploy
else
  useradd --create-home --shell /bin/bash fomo-deploy
fi
if id -nG fomo-deploy | tr ' ' '\n' | grep -qx docker; then
  gpasswd -d fomo-deploy docker
fi
passwd -l fomo-deploy >/dev/null

install -d -m 700 -o fomo-deploy -g fomo-deploy /home/fomo-deploy/.ssh
install -m 600 -o fomo-deploy -g fomo-deploy "$key_src" /home/fomo-deploy/.ssh/authorized_keys
install -d -m 750 -o fomo-deploy -g fomo-deploy /home/fomo-deploy/backups

install -d -m 755 /etc/ssh/sshd_config.d
cat >/etc/ssh/sshd_config.d/fomo-deploy.conf <<'EOF'
Match User fomo-deploy
    PasswordAuthentication no
    KbdInteractiveAuthentication no
EOF
host_keys_created=no
sshd_checked=no
if command -v sshd >/dev/null 2>&1; then
  sshd_checked=yes
  install -d -m 755 -o root -g root /run/sshd
  if ! compgen -G '/etc/ssh/ssh_host_*_key' >/dev/null; then
    ssh-keygen -A
    host_keys_created=yes
  fi
  sshd -t
fi
if [[ -z "${GITHUB_ACTIONS:-}" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
fi

install -d -m 755 -o root -g root /usr/local/lib/fomo /usr/local/lib/fomo/rollback-src /usr/local/lib/fomo/host/scripts /etc/fomo
install -m 755 -o root -g root "$script_dir/fomo-deploy-helper" /usr/local/lib/fomo/fomo-deploy-helper
install -m 755 -o root -g root "$script_dir/approved-rollback.sh" /usr/local/lib/fomo/rollback-src/approved-rollback.sh
install -m 644 -o root -g root "$script_dir/rollback-decision.mjs" /usr/local/lib/fomo/rollback-src/rollback-decision.mjs
install -m 755 -o root -g root "$script_dir/preflight.sh" /usr/local/lib/fomo/host/scripts/preflight.sh
install -m 644 -o root -g root "$script_dir/preflight-live.mjs" /usr/local/lib/fomo/host/scripts/preflight-live.mjs
install -m 644 -o root -g root "$script_dir/preflight-check.mjs" /usr/local/lib/fomo/host/scripts/preflight-check.mjs
install -m 755 -o root -g root "$script_dir/cutover-report.sh" /usr/local/lib/fomo/host/scripts/cutover-report.sh
if [[ ! -f /etc/fomo/rollback-manifest.json ]]; then
  cat >/etc/fomo/rollback-manifest.json <<'EOF'
{
  "policy": "forward-fix-only",
  "reason": "No schema-compatible fallback digest has been tested against migrations through 031_run_identity.",
  "affectedServices": ["screener", "alerter", "outcomes", "ingestor"],
  "targets": []
}
EOF
fi
install -m 644 -o root -g root /etc/fomo/rollback-manifest.json /usr/local/lib/fomo/rollback-src/rollback-manifest.json
install -m 644 -o root -g root "$repo_root/infra/docker-compose.yml" /etc/fomo/docker-compose.yml
if [[ ! -f /etc/fomo/deploy-authorization.json ]]; then
  cat >/etc/fomo/deploy-authorization.json <<'EOF'
{
  "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  "composeProject": "fomo-copilot"
}
EOF
fi
chown root:root /etc/fomo/deploy-authorization.json /etc/fomo/docker-compose.yml /etc/fomo/rollback-manifest.json
chmod 644 /etc/fomo/deploy-authorization.json /etc/fomo/docker-compose.yml /etc/fomo/rollback-manifest.json

cat >/etc/sudoers.d/fomo-deploy <<'EOF'
fomo-deploy ALL=(root) NOPASSWD: /usr/local/lib/fomo/fomo-deploy-helper
EOF
chmod 440 /etc/sudoers.d/fomo-deploy
visudo -cf /etc/sudoers.d/fomo-deploy >/dev/null

if [[ -n "$root_keys" ]]; then
  now=$(sha256sum /root/.ssh/authorized_keys | awk '{print $1}')
  [[ "$now" == "$root_keys" ]] || {
    echo "root authorized_keys changed; refusing" >&2
    exit 1
  }
fi

echo "change user fomo-deploy shell=/bin/bash docker_group=no"
echo "change password login locked"
echo "change authorized_keys from the supplied public key"
echo "change sshd Match User fomo-deploy PasswordAuthentication no"
if [[ "$sshd_checked" == yes ]]; then
  echo "change sshd privilege separation directory /run/sshd"
fi
if [[ "$host_keys_created" == yes ]]; then
  echo "change ssh host keys generated because none existed"
else
  echo "unchanged ssh host keys"
fi
echo "change helper /usr/local/lib/fomo/fomo-deploy-helper root:root mode 755"
echo "change sudoers only /usr/local/lib/fomo/fomo-deploy-helper"
echo "change protected config /etc/fomo/docker-compose.yml"
echo "change authorization manifest /etc/fomo/deploy-authorization.json"
echo "unchanged root account"
echo "unchanged root authorized_keys"
echo "privileged operations: rehearse backup promote install-rollback preflight report diagnostic-status diagnostic-start diagnostic-stop"
