#!/usr/bin/env bash
# Aborts when a deploy is queued or running, or when deploy.yml can start on push.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

if [[ "${1:-}" == "--fixture-busy" ]]; then
  echo "abort: a deployment is queued or running" >&2
  exit 1
fi
if [[ "${1:-}" == "--fixture-clear" ]]; then
  echo "no queued or running deployment"
  exit 0
fi

if grep -Eq '^[[:space:]]*push:' .github/workflows/deploy.yml; then
  echo "abort: deploy.yml still has a push trigger" >&2
  exit 1
fi
if [[ -f .github/workflows/publish.yml ]] && grep -Eq '^[[:space:]]*push:' .github/workflows/publish.yml; then
  echo "abort: publish.yml still has a push trigger" >&2
  exit 1
fi

repo=${GITHUB_REPOSITORY:-Blaquemaster/fomo-copilot}
queued=$(gh run list --repo "$repo" --workflow deploy.yml --status queued --limit 20 --json databaseId,status,headSha,event)
running=$(gh run list --repo "$repo" --workflow deploy.yml --status in_progress --limit 20 --json databaseId,status,headSha,event)
echo "queued deployments: $queued"
echo "running deployments: $running"
if [[ "$queued" != "[]" || "$running" != "[]" ]]; then
  echo "abort: a deployment is queued or running" >&2
  exit 1
fi
echo "no queued or running deployment"
