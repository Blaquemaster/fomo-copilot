#!/usr/bin/env bash
# Disable the production Deploy workflow before the release merge.
# This does not merge, publish, or contact the droplet.
set -euo pipefail

if [[ "${1:-}" == "--fixture-enabled" ]]; then
  echo "sequence stopped: production deploy workflow is still enabled" >&2
  exit 1
fi
if [[ "${1:-}" == "--fixture-disabled" ]]; then
  echo "production deploy workflow is disabled"
  exit 0
fi
if [[ "${1:-}" != "--check" && "${1:-}" != "--disable" ]]; then
  echo "usage: hold-deploy-workflow.sh --check|--disable" >&2
  exit 1
fi

repo=${GITHUB_REPOSITORY:-Blaquemaster/fomo-copilot}
state=$(gh workflow view deploy.yml --repo "$repo" --json state --jq .state)
echo "deploy workflow state ${state}"
if [[ "$1" == "--check" ]]; then
  if [[ "$state" != "disabled_manually" && "$state" != "disabled_inactivity" ]]; then
    echo "sequence stopped: disable the Deploy workflow on main before merging" >&2
    exit 1
  fi
  echo "production deploy workflow is disabled"
  exit 0
fi
if [[ "${CONFIRM:-}" != "hold-production-deploy" ]]; then
  echo "refusing to disable without CONFIRM=hold-production-deploy" >&2
  exit 1
fi
gh workflow disable deploy.yml --repo "$repo"
echo "production deploy workflow is disabled"
