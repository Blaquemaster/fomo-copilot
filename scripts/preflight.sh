#!/usr/bin/env bash
# Build-only checker. It compares two local JSON files and does not open a connection.
set -euo pipefail

if [[ -f /.dockerenv ]]; then
  echo "preflight is build-only and does not contact a host" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
accepted=""
observed=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --accepted)
      accepted=$2
      shift 2
      ;;
    --observed)
      observed=$2
      shift 2
      ;;
    --host | --live)
      echo "preflight is build-only and does not contact a host" >&2
      exit 1
      ;;
    *)
      echo "preflight is build-only and does not contact a host" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$accepted" || -z "$observed" ]]; then
  echo "preflight needs --accepted and --observed" >&2
  exit 1
fi

node "$root/scripts/preflight-check.mjs" --accepted "$accepted" --observed "$observed"
