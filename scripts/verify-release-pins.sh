#!/usr/bin/env bash
# Recompute hashes of the compose file and host scripts. Exit 1 on any mismatch.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
pins=infra/release-pins.json
if [[ ! -f "$pins" ]]; then
  echo "release pins are missing" >&2
  exit 1
fi

node --input-type=module <<'JS'
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const pins = JSON.parse(readFileSync("infra/release-pins.json", "utf8"));
let failed = false;
for (const [file, expected] of Object.entries(pins.files)) {
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== expected) {
    process.stderr.write(`pin mismatch ${file}\n`);
    failed = true;
  }
}
if (!/^[0-9a-f]{40}$/.test(pins.revision)) {
  process.stderr.write("pin revision must be a commit SHA\n");
  failed = true;
}
if (failed) process.exit(1);
process.stdout.write(`pins match revision ${pins.revision}\n`);
JS
revision=$(node --input-type=module -e "import {readFileSync} from 'node:fs'; process.stdout.write(JSON.parse(readFileSync('infra/release-pins.json','utf8')).revision)")
git cat-file -e "${revision}^{commit}"
git merge-base --is-ancestor "$revision" HEAD
