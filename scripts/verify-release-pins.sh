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
if (failed) process.exit(1);
process.stdout.write(`pins match revision ${pins.revision}\n`);
JS
