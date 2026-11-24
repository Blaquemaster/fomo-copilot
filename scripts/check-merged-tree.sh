#!/usr/bin/env bash
# After the release merge, main's tree must equal the reviewed candidate tree.
# The merge commit id may differ. The tree hash may not.
set -euo pipefail

tree=""
ref="origin/main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tree)
      tree=$2
      shift 2
      ;;
    --ref)
      ref=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ ! "$tree" =~ ^[0-9a-f]{40}$ ]]; then
  echo "sequence stopped: reviewed tree hash is required" >&2
  exit 1
fi
actual=$(git rev-parse "${ref}^{tree}")
if [[ "$actual" != "$tree" ]]; then
  echo "sequence stopped: ${ref} tree ${actual} != reviewed candidate tree ${tree}" >&2
  exit 1
fi
echo "merged tree matches the reviewed candidate ${tree}"
