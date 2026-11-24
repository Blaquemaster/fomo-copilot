#!/usr/bin/env bash
# Builds the ingestor image and records its id. Does not push or deploy.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
out=${1:-release-digest.json}
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:?set CI_APP_ENV}

meta=$(mktemp)
docker buildx build --provenance=false --sbom=false --load \
  --metadata-file "$meta" \
  -f apps/ingestor/Dockerfile \
  -t "${project}-ingestor" .
registry=$(node --input-type=module -e 'import { readFileSync } from "node:fs"; const meta = JSON.parse(readFileSync(process.argv[1], "utf8")); process.stdout.write(meta["containerimage.digest"] || "");' "$meta")
if [[ -z "$registry" ]]; then
  oci=$(mktemp)
  docker buildx build --provenance=false --sbom=false \
    -f apps/ingestor/Dockerfile \
    -o "type=oci,dest=${oci}" .
  registry=$(node scripts/registry-digest.mjs "$oci")
  rm -f "$oci"
fi
test -n "$registry"
ref="ghcr.io/blaquemaster/fomo-copilot/ingestor@${registry}"
local_id=$(docker image inspect --format '{{.Id}}' "${project}-ingestor")
commit=$(git rev-parse HEAD)
printf '%s\n' "{\"commit\":\"$commit\",\"ingestorImage\":\"$ref\",\"registryDigest\":\"$registry\",\"localImageId\":\"$local_id\",\"schemaThrough\":\"031_run_identity\",\"fallback\":\"forward-fix-only\",\"pushed\":false}" >"$out"
echo "release digest $ref"
rm -f "$meta"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Release candidate `%s` registry reference `%s`. Not pushed. Fallback is forward-fix-only.\n' "$commit" "$ref" >>"$GITHUB_STEP_SUMMARY"
fi
