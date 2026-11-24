#!/usr/bin/env bash
# Read-only comparison of a schema_migrations listing to the production baseline.
# A difference stops the migration step. This script does not write.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
applied=""
baseline="$root/infra/db/production-baseline.txt"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --applied)
      applied=$2
      shift 2
      ;;
    --baseline)
      baseline=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: schema drift" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$applied" || ! -f "$applied" || ! -f "$baseline" ]]; then
  echo "sequence stopped: schema drift" >&2
  exit 1
fi

normalize() {
  grep -v '^#' "$1" | grep -v '^$' | sort
}

if ! diff -q <(normalize "$baseline") <(normalize "$applied") >/dev/null; then
  echo "sequence stopped: schema drift" >&2
  diff -u <(normalize "$baseline") <(normalize "$applied") >&2 || true
  exit 1
fi
echo "schema inventory matches the production baseline"
