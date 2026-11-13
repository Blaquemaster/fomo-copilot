#!/usr/bin/env bash
# Print 20 recent stored ingest events with Solscan links.
# On the server, from the repo root:
#   docker compose --env-file .env -f infra/docker-compose.yml exec -T ingestor \
#     node apps/ingestor/dist/main.js --spot-check
# On a laptop, after npm run build and with .env filled in:
#   node --env-file=.env apps/ingestor/dist/main.js --spot-check

set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f apps/ingestor/dist/main.js ]]; then
  node --env-file=.env apps/ingestor/dist/main.js --spot-check
  exit 0
fi
echo "Build first: npm run build" >&2
exit 1
