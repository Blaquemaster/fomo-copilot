#!/usr/bin/env bash
# Runs on the CI runner only. It does not contact the production server.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

app_env=$(mktemp)
shadow_env=$(mktemp)
fail_compose=$(mktemp)
trap 'rm -f "$app_env" "$shadow_env" "$fail_compose" ${schema_file:-} ${manifest_file:-} ${empty_manifest:-}; docker compose --project-name fomo-ci --env-file "$app_env" -f infra/docker-compose.yml -f infra/docker-compose.ci.yml down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

cat >"$app_env" <<'EOF'
POSTGRES_USER=fomo
POSTGRES_PASSWORD=password1
POSTGRES_DB=fomo
DATABASE_URL=postgres://fomo:password1@postgres:5432/fomo
HELIUS_API_KEY=ci-fake-helius
TELEGRAM_BOT_TOKEN=ci-fake-token
TELEGRAM_ADMIN_CHAT_ID=1
NODE_ENV=test
LOG_LEVEL=info
PAPER_ENABLED=false
ALERTS_ENABLED=false
OUTCOMES_ENABLED=false
SHADOW_ENABLED=false
EOF

cat >"$shadow_env" <<'EOF'
POSTGRES_USER=fomo_shadow_ci
POSTGRES_PASSWORD=password1
POSTGRES_DB=fomo
DATABASE_URL=postgres://fomo_shadow_ci:password1@postgres:5432/fomo
HELIUS_API_KEY=ci-fake-helius
NODE_ENV=test
LOG_LEVEL=info
PAPER_ENABLED=false
ALERTS_ENABLED=false
OUTCOMES_ENABLED=true
SHADOW_ENABLED=true
EOF

export CI_APP_ENV="$app_env"
export CI_SHADOW_ENV="$shadow_env"
export COMPOSE_PROJECT_NAME=fomo-ci

compose() {
  docker compose --project-name fomo-ci --env-file "$app_env" \
    -f infra/docker-compose.yml -f infra/docker-compose.ci.yml "$@"
}

echo "build screener and alerter images"
compose build screener alerter
image_id=$(docker images --format '{{.Repository}} {{.ID}}' | awk '/fomo-ci-screener/{print $2; exit}')
test -n "$image_id"
docker tag "$image_id" fomo-ci-screener:previous

echo "start postgres"
compose up -d postgres
for _ in $(seq 1 30); do
  if compose exec -T postgres pg_isready -U fomo -d fomo; then
    break
  fi
  sleep 2
done
compose exec -T postgres pg_isready -U fomo -d fomo

echo "migrate"
compose --profile paper run --rm --no-deps --entrypoint node screener \
  --input-type=module -e 'import { createPool, migrate } from "@fomo/core"; const pool = createPool(process.env.DATABASE_URL); await migrate(pool); await pool.end();'

echo "stale container restart"
compose --profile paper run -d --name fomo-ci-stale-screener --no-deps -e PAPER_ENABLED=TRUE -e ALERTS_ENABLED=yes screener
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Status}}' fomo-ci-stale-screener)
  if [ "$status" = "exited" ]; then
    break
  fi
  sleep 1
done
test "$(docker inspect -f '{{.State.Status}}' fomo-ci-stale-screener)" = "exited"
docker start fomo-ci-stale-screener >/dev/null
docker wait fomo-ci-stale-screener >/dev/null || true
stale_log=$(docker logs fomo-ci-stale-screener 2>&1 || true)
echo "$stale_log" | grep -Eq "configuration error|screener stayed stopped"
test -z "$(docker ps -q --filter name=fomo-ci-stale-screener --filter status=running)"

echo "explicit service starts stay off"
screener_log=$(compose --profile paper run --rm --no-deps -e PAPER_ENABLED=false -e ALERTS_ENABLED=false screener)
echo "$screener_log" | grep -q "screener stayed stopped"
alerter_log=$(compose --profile paper run --rm --no-deps -e PAPER_ENABLED=false -e ALERTS_ENABLED=false alerter)
echo "$alerter_log" | grep -q "alerter stayed stopped"
test -z "$(docker ps --format '{{.Names}}' | grep -E 'screener|alerter' || true)"

echo "restart existing postgres does not start paper"
compose restart postgres
sleep 2
test -z "$(docker ps --format '{{.Names}}' | grep -E 'screener|alerter' || true)"

echo "simulated failed deploy"
cat >"$fail_compose" <<'EOF'
services:
  screener:
    image: fomo-ci-screener:missing-deploy
    pull_policy: never
    profiles: ["paper"]
EOF
set +e
compose -f "$fail_compose" --profile paper up -d --no-build screener
fail_code=$?
set -e
test "$fail_code" -ne 0
test -z "$(docker ps --format '{{.Names}}' | grep -E 'screener|alerter' || true)"

echo "build an unguarded image the rollback command must refuse"
docker build -f infra/legacy-screener.Dockerfile -t fomo-ci-screener:legacy .
network=$(docker network ls --format '{{.Name}}' | grep '^fomo-ci' | head -1)
test -n "$network"
guarded_id=$(docker image inspect --format '{{.Id}}' fomo-ci-screener:previous)
legacy_id=$(docker image inspect --format '{{.Id}}' fomo-ci-screener:legacy)
test "$guarded_id" != "$legacy_id"
schema_file=$(mktemp)
manifest_file=$(mktemp)
empty_manifest=$(mktemp)
compose exec -T postgres psql -U fomo -d fomo -At -c "select id from schema_migrations order by id" >"$schema_file"
grep -q "031_run_identity" "$schema_file"
cat >"$manifest_file" <<EOF
{
  "affectedServices": ["screener", "alerter", "outcomes", "shadow"],
  "targets": [
    {
      "imageDigest": "${guarded_id}",
      "builtAt": "2020-01-01T00:00:00Z",
      "schemaRequirements": ["031_run_identity"],
      "permittedServices": ["screener"],
      "permittedModes": {
        "paper": false,
        "alerts": false,
        "outcomes": false,
        "shadow": false,
        "wideRecovery": false
      },
      "gateTestsPassed": true,
      "evidence": ["verify", "compose-gates"]
    }
  ]
}
EOF
printf '%s\n' '{"targets":[]}' >"$empty_manifest"

echo "unguarded rollback target is rejected before paper starts"
set +e
reject_log=$(bash scripts/approved-rollback.sh \
  --manifest "$manifest_file" \
  --schema "$schema_file" \
  --target fomo-ci-screener:legacy \
  --execute \
  --project fomo-ci \
  --env-file "$app_env" \
  --network "$network" 2>&1)
reject_code=$?
set -e
test "$reject_code" -eq 3
echo "$reject_log" | grep -q "rejected before start"
if echo "$reject_log" | grep -q "without a stop gate"; then
  echo "unguarded image started paper" >&2
  exit 1
fi
test -z "$(docker ps -aq --filter ancestor=fomo-ci-screener:legacy)"

echo "permitted guarded fallback starts and stays stopped"
fallback_log=$(bash scripts/approved-rollback.sh \
  --manifest "$manifest_file" \
  --schema "$schema_file" \
  --digest "$guarded_id" \
  --execute \
  --env-file "$app_env" \
  --network "$network")
echo "$fallback_log" | grep -q "screener stayed stopped"

echo "no approved fallback stops services and requires a forward fix"
set +e
forward_log=$(bash scripts/approved-rollback.sh \
  --manifest "$empty_manifest" \
  --schema "$schema_file" \
  --digest "$legacy_id" \
  --execute \
  --project fomo-ci \
  --env-file "$app_env" \
  --network "$network" 2>&1)
forward_code=$?
set -e
test "$forward_code" -eq 2
echo "$forward_log" | grep -q "forward fix required"
test -z "$(docker ps --format '{{.Names}}' | grep -E 'screener|alerter|outcomes|shadow' || true)"
rm -f "$schema_file" "$manifest_file" "$empty_manifest"

echo "restricted shadow role on the CI database only"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo <<'SQL'
drop role if exists fomo_shadow_ci;
create role fomo_shadow_ci login nosuperuser nocreatedb nocreaterole noinherit password 'password1';
grant connect on database fomo to fomo_shadow_ci;
grant usage on schema public to fomo_shadow_ci;
grant select on table
  raw_events, candidates, wallet_fill, tracked_wallet, ingest_backfill, ingest_coin,
  autobuy_intent, phasec_position, phasec_alert
  to fomo_shadow_ci;
grant select, insert, update on table
  phasec_candidate, phasec_execution, phasec_observation, phasec_quote_attempt,
  phasec_wallet_list_version, phasec_config_history
  to fomo_shadow_ci;
revoke insert, update, delete, truncate on table
  phasec_position, phasec_alert, autobuy_intent, raw_events
  from fomo_shadow_ci;
SQL

echo "shadow container identity cannot write a position"
compose --profile shadow run --rm --no-deps --entrypoint node shadow \
  --input-type=module -e "$(cat <<'JS'
import { createPool } from "@fomo/core";
const pool = createPool(process.env.DATABASE_URL);
const who = await pool.query("select current_user");
if (who.rows[0].current_user !== "fomo_shadow_ci") {
  throw new Error("shadow is not the restricted role");
}
let denied = false;
try {
  await pool.query(
    "insert into phasec_position (mint, stage, arm, status, alert_at, entry_after) values ('ci-shadow-deny', 'post_graduation', 'wallets_x_screen', 'pending', now(), now())",
  );
} catch (error) {
  denied = /permission denied/i.test(String(error));
}
if (!denied) throw new Error("restricted role wrote a position");
await pool.query("select count(*) from autobuy_intent");
await pool.end();
JS
)"

echo "shadow on, paper off"
compose --profile shadow up -d --no-deps shadow
found=0
for _ in $(seq 1 40); do
  if compose logs shadow 2>/dev/null | grep -q "shadow acceptance"; then
    found=1
    break
  fi
  sleep 1
done
test "$found" = "1"
test -z "$(docker ps --format '{{.Names}}' | grep -E 'screener|alerter' || true)"
compose stop shadow

echo "compose gates passed"
