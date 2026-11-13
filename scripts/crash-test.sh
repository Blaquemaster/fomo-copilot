#!/usr/bin/env bash
# Force one app to throw, send a crash alert to the admin Telegram chat, and exit.
# The non-zero process exit is expected. This script exits 0 when the app exits 1.
#
# Usage, from the repository root, with a filled-in .env:
#   scripts/crash-test.sh ingestor
#   scripts/crash-test.sh screener
#   scripts/crash-test.sh alerter
#
# Without Docker, after `npm run build`:
#   node --env-file=.env apps/ingestor/dist/main.js --crash-test

set -euo pipefail

app="${1:-}"
case "$app" in
  ingestor | screener | alerter) ;;
  *)
    echo "usage: scripts/crash-test.sh ingestor|screener|alerter" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example and fill it in. Do not commit .env." >&2
  exit 1
fi

set +e
docker compose --env-file .env -f infra/docker-compose.yml run --rm --no-deps --entrypoint node \
  "$app" "apps/${app}/dist/main.js" --crash-test
code=$?
set -e

if [[ "$code" -eq 1 ]]; then
  echo "Crash test process exited 1, which is expected. Check the private admin Telegram chat for the alert."
  exit 0
fi

echo "Unexpected exit code ${code}." >&2
exit "$code"
