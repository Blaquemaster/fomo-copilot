#!/usr/bin/env bash
# Copies the rollback controller outside the git checkout.
# CI passes DEST_LIB and DEST_ETC. The owner paths are the defaults.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
dest_lib=${DEST_LIB:-/usr/local/lib/fomo}
dest_etc=${DEST_ETC:-/etc/fomo}

mkdir -p "$dest_lib" "$dest_etc"
cp "$root/scripts/approved-rollback.sh" "$dest_lib/approved-rollback.sh"
cp "$root/scripts/rollback-decision.mjs" "$dest_lib/rollback-decision.mjs"
chmod 755 "$dest_lib/approved-rollback.sh"

# No tested image can run the schema through 031_run_identity except the
# release image itself. That is a forward fix, not a fallback.
cat >"$dest_etc/rollback-manifest.json" <<'EOF'
{
  "policy": "forward-fix-only",
  "reason": "No schema-compatible fallback digest has been tested against migrations through 031_run_identity.",
  "affectedServices": ["screener", "alerter", "outcomes", "ingestor"],
  "targets": []
}
EOF

echo "installed $dest_lib/approved-rollback.sh"
echo "manifest $dest_etc/rollback-manifest.json"
echo "policy forward-fix-only"
