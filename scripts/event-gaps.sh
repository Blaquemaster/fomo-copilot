#!/usr/bin/env bash
# Inter-event gaps from raw_events, overall and per program.
# Usage: scripts/event-gaps.sh [hours]
# Runs inside the postgres container. Does not print connection strings.
set -euo pipefail

hours="${1:-24}"
if ! [[ "$hours" =~ ^[0-9]+$ ]] || [[ "$hours" -lt 1 || "$hours" -gt 8760 ]]; then
  echo "hours must be an integer from 1 to 8760" >&2
  exit 2
fi

sql=$(cat <<SQL
with windowed as (
  select id, program_id, received_at
  from raw_events
  where received_at >= now() - make_interval(hours => ${hours})
),
per_program as (
  select program_id,
         extract(epoch from received_at - lag(received_at) over (partition by program_id order by received_at, id)) as gap_s
  from windowed
),
overall as (
  select extract(epoch from received_at - lag(received_at) over (order by received_at, id)) as gap_s
  from windowed
)
select 'program' as scope,
       program_id,
       round(percentile_cont(0.50) within group (order by gap_s)::numeric, 3) as p50_s,
       round(percentile_cont(0.95) within group (order by gap_s)::numeric, 3) as p95_s,
       round(percentile_cont(0.99) within group (order by gap_s)::numeric, 3) as p99_s,
       round(max(gap_s)::numeric, 3) as max_s,
       count(gap_s) as gaps
from per_program
where gap_s is not null
group by program_id
union all
select 'overall',
       null,
       round(percentile_cont(0.50) within group (order by gap_s)::numeric, 3),
       round(percentile_cont(0.95) within group (order by gap_s)::numeric, 3),
       round(percentile_cont(0.99) within group (order by gap_s)::numeric, 3),
       round(max(gap_s)::numeric, 3),
       count(gap_s)
from overall
where gap_s is not null
order by scope, program_id nulls last;
SQL
)

if ! docker inspect fomo-copilot-postgres-1 >/dev/null 2>&1; then
  echo "fomo-copilot-postgres-1 is not running" >&2
  exit 1
fi

printf '%s\n' "$sql" | docker exec -i fomo-copilot-postgres-1 \
  sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
