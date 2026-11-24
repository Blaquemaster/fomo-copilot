#!/usr/bin/env bash
# Isolated restore and upgrade rehearsal. It uses the compose Postgres only.
# It does not contact production.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:?set CI_APP_ENV}

compose() {
  docker compose --project-name "$project" --env-file "$app_env" \
    -f infra/docker-compose.yml -f infra/docker-compose.ci.yml "$@"
}

psql_admin() {
  compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d postgres "$@"
}

echo "synthetic main migration table"
psql_admin -c "drop database if exists fomo_rehearse"
psql_admin -c "drop database if exists fomo_restore"
psql_admin -c "create database fomo_rehearse"
{
  echo "create table schema_migrations (id text primary key);"
  grep -v '^#' infra/db/production-baseline.txt | grep -v '^$' | while read -r id; do
    echo "insert into schema_migrations (id) values ('$id');"
  done
} | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo_rehearse

applied=$(mktemp)
compose exec -T postgres psql -U fomo -d fomo_rehearse -At -c "select id from schema_migrations order by id" >"$applied"
report=$(node scripts/migration-inventory.mjs --release-source packages/core/src/db/ingest.ts --applied "$applied")
echo "$report"
echo "$report" | grep -q '"timeoutRollsBack":"whole_batch"'
echo "$report" | grep -q '"pending":\["023_scale_booking"'

password=$(grep '^POSTGRES_PASSWORD=' "$app_env" | cut -d= -f2-)
compose --profile paper run --rm --no-deps \
  -e "DATABASE_URL=postgres://fomo:${password}@postgres:5432/fomo_rehearse" \
  --entrypoint node screener \
  --input-type=module -e 'import { createPool, migrate } from "@fomo/core"; const pool = createPool(process.env.DATABASE_URL); await migrate(pool); await pool.end();'

compose exec -T postgres psql -U fomo -d fomo_rehearse -At -c "select id from schema_migrations order by id" >"$applied"
after=$(node scripts/migration-inventory.mjs --release-source packages/core/src/db/ingest.ts --applied "$applied")
echo "$after"
echo "$after" | grep -q '"pending":\[\]'

echo "timeout rolls back the open transaction"
set +e
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo_rehearse <<'SQL'
create table rehearsal_timeout_probe (id integer);
begin;
set local statement_timeout = '500ms';
insert into rehearsal_timeout_probe values (1);
select pg_sleep(2);
commit;
SQL
set -e
count=$(compose exec -T postgres psql -U fomo -d fomo_rehearse -At -c "select count(*) from rehearsal_timeout_probe")
test "$count" = "0"

echo "dump, roles, restore into a second database"
dump=$(mktemp)
roles=$(mktemp)
compose exec -T postgres pg_dump -U fomo -d fomo_rehearse -Fc >"$dump"
compose exec -T postgres pg_dumpall -U fomo --roles-only >"$roles"
grep -q 'ROLE fomo' "$roles"
psql_admin -c "create database fomo_restore"
compose exec -T postgres pg_restore -U fomo -d fomo_restore --no-owner <"$dump"
restored=$(compose exec -T postgres psql -U fomo -d fomo_restore -At -c "select count(*) from schema_migrations where id = '031_run_identity'")
test "$restored" = "1"
rm -f "$applied" "$dump" "$roles"
echo "rehearsal passed"
