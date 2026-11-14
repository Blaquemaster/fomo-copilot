#!/usr/bin/env bash
# Owner-run bootstrap for a fresh Ubuntu droplet (DigitalOcean Basic, FRA1).
# The coding agent never SSHes to this machine. You run this script yourself, as root.
#
# It installs Docker, creates a deploy user, installs SSH public keys you pass in,
# generates a separate read-only GitHub deploy key that stays on the server,
# turns off SSH password login, and sets ufw to deny inbound traffic except SSH.
#
# It does not disable root key login. Confirm you can `ssh deploy@HOST` in a
# second terminal before you close the session you used to run this script.

set -euo pipefail

usage() {
  cat << 'EOF'
Usage:
  sudo bash infra/bootstrap-droplet.sh --i-understand \
    --authorized-key "ssh-ed25519 AAAA... comment" \
    [--authorized-key "ssh-ed25519 AAAA... github-actions"] \
    [--repo git@github.com:OWNER/fomo-copilot.git]

--authorized-key   Public key installed for the deploy user. Repeat the flag
                   for your own key and for the public half of DEPLOY_SSH_KEY.
--repo             SSH URL to clone into /opt/fomo-copilot after the GitHub
                   deploy key below is attached to the repository (read-only).
--i-understand     Required. This script changes SSH and the firewall.
EOF
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root on the droplet." >&2
  exit 1
fi

understand=0
repo=""
keys=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --i-understand)
      understand=1
      shift
      ;;
    --authorized-key)
      if [[ $# -lt 2 ]]; then
        echo "--authorized-key needs a public key argument" >&2
        exit 2
      fi
      keys+=("$2")
      shift 2
      ;;
    --repo)
      if [[ $# -lt 2 ]]; then
        echo "--repo needs a git@github.com:owner/name.git argument" >&2
        exit 2
      fi
      repo="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ "$understand" -ne 1 ]]; then
  usage
  echo "Refusing to run without --i-understand. Read docs/runbook.md first." >&2
  exit 1
fi

if [[ ${#keys[@]} -eq 0 ]]; then
  echo "Pass at least one --authorized-key so the deploy user can log in." >&2
  exit 1
fi

for key in "${keys[@]}"; do
  if [[ "$key" == *$'\n'* || "$key" == *$'\r'* ]]; then
    echo "An authorized key contains a newline." >&2
    exit 1
  fi
  if [[ ! "$key" =~ ^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256)[[:space:]]+[A-Za-z0-9+/=]+([[:space:]].*)?$ ]]; then
    echo "An authorized key is not a single ssh-ed25519, ssh-rsa, or ecdsa public key." >&2
    exit 1
  fi
done

if [[ -n "$repo" && ! "$repo" =~ ^git@github\.com:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(\.git)?$ ]]; then
  echo "Repo must look like git@github.com:owner/name.git" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot read /etc/os-release." >&2
  exit 1
fi
# shellcheck disable=SC1091
. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "This script supports Ubuntu. Detected ID=${ID:-unknown}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates cron curl gnupg ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
codename="${UBUNTU_CODENAME:-${VERSION_CODENAME}}"
arch="$(dpkg --print-architecture)"
echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

if [[ ! -f /etc/docker/daemon.json ]]; then
  cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
  systemctl restart docker
fi

if ! id deploy >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --user-group deploy
fi
passwd -l deploy
usermod -aG docker deploy

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
authorized=/home/deploy/.ssh/authorized_keys
umask 077
: > "${authorized}.tmp"
for key in "${keys[@]}"; do
  printf '%s\n' "$key" >> "${authorized}.tmp"
done
mv "${authorized}.tmp" "$authorized"
chown deploy:deploy "$authorized"
chmod 600 "$authorized"

# GitHub's published SSH host keys, fetched from https://api.github.com/meta on 2026-11-13.
# Re-check that page if GitHub announces a host-key rotation.
cat > /home/deploy/.ssh/known_hosts << 'EOF'
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
EOF
chown deploy:deploy /home/deploy/.ssh/known_hosts
chmod 644 /home/deploy/.ssh/known_hosts

if [[ ! -f /home/deploy/.ssh/github_deploy ]]; then
  sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/github_deploy -N "" -C "fomo-copilot-github-readonly"
fi
chmod 600 /home/deploy/.ssh/github_deploy
chmod 644 /home/deploy/.ssh/github_deploy.pub
chown deploy:deploy /home/deploy/.ssh/github_deploy /home/deploy/.ssh/github_deploy.pub

cat > /home/deploy/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile /home/deploy/.ssh/github_deploy
  IdentitiesOnly yes
  StrictHostKeyChecking yes
  UserKnownHostsFile /home/deploy/.ssh/known_hosts
EOF
chown deploy:deploy /home/deploy/.ssh/config
chmod 600 /home/deploy/.ssh/config

if ! sudo -u deploy git config --global --get-all safe.directory 2>/dev/null | grep -qx /opt/fomo-copilot; then
  sudo -u deploy git config --global --add safe.directory /opt/fomo-copilot
fi

if [[ ! -f /swapfile ]]; then
  fallocate -l 1G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=1024
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

cat > /etc/ssh/sshd_config.d/99-fomo-copilot.conf << 'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
EOF
sshd -t
systemctl reload ssh

ssh_port="$(sshd -T | awk '/^port / { print $2; exit }')"
ssh_port="${ssh_port:-22}"
ufw default deny incoming
ufw default allow outgoing
ufw allow "${ssh_port}/tcp" comment 'SSH for now; Phase 7 restricts this to Tailscale'
ufw --force enable

echo
echo "GitHub read-only deploy key (add this under the repo Settings, Deploy keys, Allow write access UNCHECKED):"
cat /home/deploy/.ssh/github_deploy.pub
echo

if [[ -n "$repo" ]]; then
  if [[ -d /opt/fomo-copilot/.git ]]; then
    echo "/opt/fomo-copilot already exists; leaving the checkout in place."
  else
    install -d -o deploy -g deploy /opt/fomo-copilot
    sudo -u deploy git clone --branch main "$repo" /opt/fomo-copilot
  fi
else
  echo "No --repo given. After you add the deploy key on GitHub, re-run with --repo to clone into /opt/fomo-copilot."
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -f "${script_dir}/fomo-healthcheck.sh" || ! -f "${script_dir}/fomo-healthcheck.cron" ]]; then
  echo "Healthcheck files are missing next to bootstrap-droplet.sh." >&2
  exit 1
fi
install -m 0755 "${script_dir}/fomo-healthcheck.sh" /usr/local/bin/fomo-healthcheck.sh
install -m 0644 "${script_dir}/fomo-healthcheck.cron" /etc/cron.d/fomo-healthcheck
touch /var/log/fomo-healthcheck.log
chmod 0644 /var/log/fomo-healthcheck.log

echo
echo "Bootstrap finished."
echo "Healthcheck cron is installed. Create /etc/fomo-healthcheck.env yourself, owner root:root, mode 0600."
echo "That file is not committed. Put the healthcheck URL in it before expecting the cron job to succeed."
echo "Open a second terminal and confirm: ssh -i YOUR_KEY deploy@THIS_HOST"
echo "Root key login is still allowed. Password login is off. Inbound ufw allows SSH only."
echo "Phase 7 (not done): Tailscale-only SSH, unattended upgrades, backups, Helius IP allow-list."
