#!/usr/bin/env bash
# Check one downloaded OCI archive against its handoff record.
# Checksums are computed here. A registry download warning is not this check.
set -euo pipefail

archive=""
handoff=""
run_id=""
artifact_id=""
repository="Blaquemaster/fomo-copilot"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      archive=$2
      shift 2
      ;;
    --handoff)
      handoff=$2
      shift 2
      ;;
    --run-id)
      run_id=$2
      shift 2
      ;;
    --artifact-id)
      artifact_id=$2
      shift 2
      ;;
    --repository)
      repository=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$archive" || -z "$handoff" || -z "$run_id" || -z "$artifact_id" ]]; then
  echo "sequence stopped: archive, handoff, run id, and artifact id are required" >&2
  exit 1
fi
if [[ ! -f "$archive" || ! -f "$handoff" ]]; then
  echo "sequence stopped: artifact is missing or expired" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
actual=$(sha256sum "$archive" | awk '{print $1}')
expected_sum=$(node --input-type=module -e "import {readFileSync} from 'node:fs'; process.stdout.write(JSON.parse(readFileSync(process.argv[1],'utf8')).ociArchiveSha256)" "$handoff")
if [[ "$actual" != "$expected_sum" ]]; then
  echo "sequence stopped: OCI archive checksum does not match" >&2
  exit 1
fi
index_digest=$(node "$root/scripts/registry-digest.mjs" "$archive")
node --input-type=module - "$handoff" "$actual" "$index_digest" "$run_id" "$artifact_id" "$repository" <<'JS'
import { readFileSync } from "node:fs";

const [file, checksum, indexDigest, runId, artifactId, repository] = process.argv.slice(2);
const doc = JSON.parse(readFileSync(file, "utf8"));
const fail = (message) => {
  process.stderr.write(`sequence stopped: ${message}\n`);
  process.exit(1);
};
if (doc.repository !== repository) fail("artifact is for a different repository");
if (String(doc.runId) !== runId) fail("artifact is from a different run");
if (doc.artifactId !== "pending-upload" && String(doc.artifactId) !== artifactId) {
  fail("artifact id does not match");
}
if (doc.ociArchiveSha256 !== checksum) fail("OCI archive checksum does not match");
if (doc.registryDigest !== indexDigest) fail("OCI index digest does not match");
if (doc.platform !== "linux/amd64") fail("artifact is not the tested linux/amd64 image");
if (!/^sha256:[0-9a-f]{64}$/.test(doc.localImageId ?? "")) fail("tested image id is missing");
if (!/^[0-9a-f]{40}$/.test(doc.sourceCommit ?? "")) fail("source commit is missing");
process.stdout.write(
  `handoff matches run ${runId} artifact ${artifactId} digest ${indexDigest}\n`,
);
JS
