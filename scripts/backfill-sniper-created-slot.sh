#!/usr/bin/env bash
# Idempotent 7-day created_slot backfill for migration 022.
# migrate() runs this automatically after the 022 schema transaction, in 2-hour
# batches under a 45s statement timeout, behind pg_advisory_lock so only one
# service does it. If the 022_sniper_created_slot_backfill marker is already
# in schema_migrations, migrate() skips the rescan.
# This script is a reminder of that path; the implementation is
# backfillSniperCreatedSlot() in packages/core/src/db/ingest.ts.
set -euo pipefail
echo "The batched backfill is invoked by migrate() (backfillSniperCreatedSlot)."
echo "If schema_migrations already has 022_sniper_created_slot_backfill, it is a no-op."
exit 0
