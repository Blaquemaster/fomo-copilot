#!/usr/bin/env bash
# Pull one registry reference and check linux/amd64.
# The droplet is Ubuntu on DigitalOcean amd64. CI ubuntu-24.04 is the same architecture.
# A failed pull or a different image id stops the sequence before any replacement.
# This script does not build and does not start a container.
set -euo pipefail

reference=""
expected=""
platform="linux/amd64"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reference)
      reference=$2
      shift 2
      ;;
    --expected-image-id)
      expected=$2
      shift 2
      ;;
    --platform)
      platform=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: unknown argument" >&2
      exit 1
      ;;
  esac
done

echo "platform=$platform"
if [[ "$platform" != "linux/amd64" ]]; then
  echo "sequence stopped: this release is linux/amd64" >&2
  exit 1
fi
if [[ -z "$reference" || -z "$expected" ]]; then
  echo "sequence stopped: reference and expected image id are required" >&2
  exit 1
fi

repo="${reference%@sha256:*}"
digest="${reference##*@}"
if [[ "$digest" != sha256:* || "$repo" == "$reference" ]]; then
  echo "sequence stopped: reference must be repository@sha256:digest" >&2
  exit 1
fi
case "$digest" in
  sha256:766502c8029cded0d35ac946f6da35bbc46b5f3676fed0a7a5a0ee50e21aeec6 | sha256:877b38b41fcf2e28bb1aa87488d37a301798992df4e2be63bddba30e3d65a4ed)
    echo "sequence stopped: reference is not approvable" >&2
    exit 1
    ;;
esac

if ! docker pull "$reference"; then
  echo "sequence stopped: pull failed" >&2
  exit 1
fi

raw=$(mktemp)
if ! docker buildx imagetools inspect --raw "$reference" >"$raw"; then
  echo "sequence stopped: pull failed" >&2
  rm -f "$raw"
  exit 1
fi

manifest_digest=$(MANIFEST_FILE="$raw" PLATFORM="$platform" node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync(process.env.MANIFEST_FILE, "utf8"));
const [osName, arch] = process.env.PLATFORM.split("/");
if (Array.isArray(doc.manifests)) {
  const hit = doc.manifests.find(
    (item) => item.platform?.os === osName && item.platform?.architecture === arch,
  );
  if (!hit?.digest) process.exit(2);
  process.stdout.write(hit.digest);
} else if (doc.config?.digest) {
  process.stdout.write("");
} else {
  process.exit(2);
}
JS
)

if [[ -n "$manifest_digest" ]]; then
  if ! docker pull "${repo}@${manifest_digest}"; then
    echo "sequence stopped: pull failed" >&2
    rm -f "$raw"
    exit 1
  fi
  docker buildx imagetools inspect --raw "${repo}@${manifest_digest}" >"$raw"
fi

config_digest=$(MANIFEST_FILE="$raw" node --input-type=module <<'JS'
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync(process.env.MANIFEST_FILE, "utf8"));
if (!doc.config?.digest) process.exit(2);
process.stdout.write(doc.config.digest);
JS
)
rm -f "$raw"

pulled_id=$(docker image inspect --format '{{.Id}}' "$reference" 2>/dev/null || true)
if [[ -z "$pulled_id" ]]; then
  pulled_id=$(docker image inspect --format '{{.Id}}' "${repo}@${manifest_digest}" 2>/dev/null || true)
fi
if [[ "$config_digest" != "$expected" && "$pulled_id" != "$expected" ]]; then
  echo "sequence stopped: image id changed; a rebuild must not be substituted" >&2
  echo "expected $expected" >&2
  echo "config $config_digest" >&2
  echo "pulled $pulled_id" >&2
  exit 1
fi
echo "published image matches the CI-tested id"
echo "replacement may start"
