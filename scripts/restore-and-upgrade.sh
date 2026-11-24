#!/usr/bin/env bash
# Restore a custom-format dump into an isolated Postgres 16 database, then apply
# the release migrations. Any failure stops the sequence. Does not touch production.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
dump=""
database=fomo_cutover
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:?set CI_APP_ENV}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump)
      dump=$2
      shift 2
      ;;
    --database)
      database=$2
      shift 2
      ;;
    --project)
      project=$2
      shift 2
      ;;
    --env-file)
      app_env=$2
      shift 2
      ;;
    *)
      echo "sequence stopped: unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "sequence stopped: restore failure, dump missing" >&2
  exit 1
fi

compose() {
  docker compose --project-name "$project" --env-file "$app_env" \
    -f infra/docker-compose.yml -f infra/docker-compose.ci.yml "$@"
}

echo "restore $dump into isolated database $database"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d postgres \
  -c "drop database if exists $database" \
  -c "create database $database"
if ! compose exec -T postgres pg_restore -U fomo -d "$database" --no-owner <"$dump"; then
  echo "sequence stopped: restore failure" >&2
  exit 1
fi
already=$(compose exec -T postgres psql -U fomo -d "$database" -At \
  -c "select count(*) from schema_migrations where id = '031_run_identity'" || echo missing)
if [[ "$already" == "1" ]]; then
  echo "sequence stopped: schema mismatch, 031_run_identity is already applied" >&2
  exit 1
fi
if [[ "$already" == "missing" ]]; then
  echo "sequence stopped: schema mismatch, schema_migrations is absent" >&2
  exit 1
fi

password=$(grep '^POSTGRES_PASSWORD=' "$app_env" | cut -d= -f2-)
if ! compose --profile paper run --rm --no-deps \
  -e "DATABASE_URL=postgres://fomo:${password}@postgres:5432/${database}" \
  --entrypoint node screener \
  --input-type=module -e 'import { createPool, migrate } from "@fomo/core"; const pool = createPool(process.env.DATABASE_URL); await migrate(pool); await pool.end();'; then
  echo "sequence stopped: upgrade failure" >&2
  exit 1
fi
applied=$(compose exec -T postgres psql -U fomo -d "$database" -At \
  -c "select count(*) from schema_migrations where id in ('023_scale_booking','031_run_identity')")
if [[ "$applied" != "2" ]]; then
  echo "sequence stopped: upgrade failure, 023-031 did not land" >&2
  exit 1
fi
echo "isolated upgrade of 023-031 succeeded"
