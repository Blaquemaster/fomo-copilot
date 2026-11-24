#!/usr/bin/env bash
# Builds the ingestor image and records its id. Does not push or deploy.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
out=${1:-release-digest.json}
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:?set CI_APP_ENV}

docker compose --project-name "$project" --env-file "$app_env" \
  -f infra/docker-compose.yml -f infra/docker-compose.ci.yml build ingestor
image_id=$(docker images --format '{{.Repository}} {{.ID}}' | awk '/ingestor/{print $2; exit}')
test -n "$image_id"
digest=$(docker image inspect --format '{{.Id}}' "$image_id")
commit=$(git rev-parse HEAD)
printf '%s\n' "{\"commit\":\"$commit\",\"ingestorImage\":\"$digest\",\"schemaThrough\":\"031_run_identity\",\"fallback\":\"forward-fix-only\"}" >"$out"
echo "release digest $digest"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Release candidate `%s` ingestor image `%s`. Fallback is forward-fix-only.\n' "$commit" "$digest" >>"$GITHUB_STEP_SUMMARY"
fi
