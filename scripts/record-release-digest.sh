#!/usr/bin/env bash
# Builds the ingestor image and records its id. Does not push or deploy.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
out=${1:-release-digest.json}
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:?set CI_APP_ENV}

docker buildx inspect fomo-oci >/dev/null 2>&1 || docker buildx create --name fomo-oci --driver docker-container
docker_tar=$(mktemp)
oci="$root/release-oci.tar"
rm -f "$oci"
docker buildx build --builder fomo-oci --provenance=false --sbom=false \
  -f apps/ingestor/Dockerfile \
  -o "type=docker,dest=${docker_tar}" \
  -o "type=oci,dest=${oci}" .
registry=$(node scripts/registry-digest.mjs "$oci")
test -s "$oci"
test -n "$registry"
loaded=$(docker load -i "$docker_tar" | awk '/Loaded image/{print $NF}')
rm -f "$docker_tar"
test -n "$loaded"
docker tag "$loaded" "${project}-ingestor"
local_id=$(docker image inspect --format '{{.Id}}' "${project}-ingestor")
if [[ "$registry" == "$local_id" ]]; then
  echo "registry digest matched the local image id; refusing to relabel it" >&2
  exit 1
fi
ref="ghcr.io/blaquemaster/fomo-copilot/ingestor@${registry}"
commit=$(git rev-parse HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
if ! git rev-parse --verify --quiet origin/main >/dev/null; then
  git fetch --no-tags origin main >/dev/null 2>&1 || true
fi
base_sha=$(git rev-parse --verify --quiet origin/main || true)
checksum=$(sha256sum "$oci" | awk '{print $1}')
printf '%s\n' "{\"commit\":\"$commit\",\"ingestorImage\":\"$ref\",\"registryDigest\":\"$registry\",\"localImageId\":\"$local_id\",\"ociArchive\":\"release-oci.tar\",\"schemaThrough\":\"031_run_identity\",\"fallback\":\"forward-fix-only\",\"pushed\":false}" >"$out"
node --input-type=module - "$root/release-handoff.json" "$commit" "$tree" "${base_sha:-}" "$registry" "$local_id" "$checksum" <<'JS'
import { writeFileSync } from "node:fs";

const [file, commit, tree, baseSha, registryDigest, localImageId, checksum] = process.argv.slice(2);
writeFileSync(
  file,
  JSON.stringify(
    {
      repository: process.env.GITHUB_REPOSITORY ?? "Blaquemaster/fomo-copilot",
      base: "main",
      baseSha,
      candidateSha: commit,
      treeHash: tree,
      runId: process.env.GITHUB_RUN_ID ?? "local",
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "0",
      sourceCommit: commit,
      artifactName: "release-oci",
      artifactId: process.env.RELEASE_ARTIFACT_ID ?? "pending-upload",
      ociArchiveSha256: checksum,
      registryDigest,
      localImageId,
      platform: "linux/amd64",
    },
    null,
    2,
  ) + "\n",
);
JS
echo "release digest $ref"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf 'Release candidate `%s` registry reference `%s`. Not pushed. Fallback is forward-fix-only.\n' "$commit" "$ref" >>"$GITHUB_STEP_SUMMARY"
fi
