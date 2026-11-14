#!/bin/bash
# FOMO Copilot host health check -> Healthchecks.io dead-man's switch.
set -u
. /etc/fomo-healthcheck.env   # HC_URL, BASE_RESTARTS (default 0)
BASE_RESTARTS=${BASE_RESTARTS:-0}
verdict=PASS; notes=()
for c in ingestor screener alerter postgres; do
  n=fomo-copilot-$c-1
  s=$(docker inspect -f '{{.State.Status}} {{.RestartCount}} {{.State.OOMKilled}}' "$n" 2>/dev/null) || { verdict=FAIL; notes+=("$c missing"); continue; }
  read st rc oom <<<"$s"
  [ "$st" = running ] || { verdict=FAIL; notes+=("$c $st"); }
  [ "$rc" -le "$BASE_RESTARTS" ] || { verdict=FAIL; notes+=("$c restarts=$rc"); }
  [ "$oom" = false ] || { verdict=FAIL; notes+=("$c oom"); }
done
age=$(docker exec fomo-copilot-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select coalesce(extract(epoch from now()-max(received_at))::int,99999) from raw_events"' 2>/dev/null)
state=$(docker exec fomo-copilot-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select state from ingest_status limit 1"' 2>/dev/null)
if [ -z "$age" ]; then verdict=FAIL; notes+=("db query failed")
elif [ "$age" -gt 600 ]; then verdict=FAIL; notes+=("last event ${age}s ago")
elif [ "$age" -gt 300 ]; then [ $verdict = PASS ] && verdict=WARN; notes+=("last event ${age}s ago")
else notes+=("last event ${age}s ago"); fi
[ "$state" = connected ] || { [ $verdict = PASS ] && verdict=WARN; notes+=("state=$state"); }
msg="$verdict: ${notes[*]}"
if [ $verdict = FAIL ]; then url="$HC_URL/fail"; else url="$HC_URL"; fi
curl -fsS -m 10 --retry 3 --data-raw "$msg" "$url" >/dev/null
echo "$(date -Is) $msg"
