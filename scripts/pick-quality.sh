#!/usr/bin/env bash
# Phase C pick-quality check. Read-only: a read-only psql session, screener logs, two .env keys.
# Run on the server:  bash /opt/fomo-copilot/scripts/pick-quality.sh [hours]
# FOMO_DIR and PQ_SQL override the app directory and the query file (for running it over ssh).
# Prints INFO/ALERT lines. Exits 1 when any ALERT is printed, 2 when the check itself failed.
set -uo pipefail
hours="${1:-6}"
[[ "$hours" =~ ^[0-9]+$ ]] || { echo "usage: pick-quality.sh [hours]"; exit 2; }
if [ -n "${FOMO_DIR:-}" ]; then cd "$FOMO_DIR" || exit 2; else cd "$(dirname "$0")/.." || exit 2; fi
query="${PQ_SQL:-scripts/pick-quality.sql}"
lines=""
add() { lines+="$1"$'\n'; }

sql="$(docker compose exec -T postgres sh -c \
  'PGOPTIONS="-c default_transaction_read_only=on" psql -X -q -t -A -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v hours='"$hours"' -f -' \
  < "$query" 2>&1)"
if [ $? -ne 0 ]; then
  echo "ALERT pick-quality query failed: ${sql}"
  exit 2
fi
add "$sql"

logs="$(docker compose logs --since 30m screener 2>/dev/null)"
failures="$(printf '%s\n' "$logs" | grep -c 'phase C pass failed' || true)"
if [ "${failures:-0}" -gt 0 ]; then
  last="$(printf '%s\n' "$logs" | grep 'phase C pass failed' | tail -1 | grep -o '"message":"[^"]*"' | head -1)"
  add "ALERT screener pass failed ${failures}x in the last 30 min ${last}"
fi

state="$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null)"
for svc in ingestor screener alerter postgres; do
  printf '%s\n' "$state" | grep -q "^${svc} running" || add "ALERT service ${svc} is not running"
done

mode="$(grep -E '^AUTOBUY_MODE=' .env | tail -1 | cut -d= -f2- | tr -d '"')"
[ "$mode" = "dry_run" ] || add "ALERT AUTOBUY_MODE is '${mode}', expected dry_run (re-apply after a deploy)"
grep -qE '^AUTOBUY_LIVE_CONFIRMED=' .env && add "ALERT AUTOBUY_LIVE_CONFIRMED is present in .env"

printf '%s' "$lines" | sed '/^$/d'
if printf '%s' "$lines" | grep -q '^ALERT'; then exit 1; fi
echo "OK no red flags"
exit 0
