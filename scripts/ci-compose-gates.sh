#!/usr/bin/env bash
# Runs on the CI runner only. It does not contact the production server.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

app_env=$(mktemp)
shadow_env=$(mktemp)
fail_compose=$(mktemp)
trap 'rm -f "$app_env" "$shadow_env" "$fail_compose"; docker compose --project-name fomo-ci --env-file "$app_env" -f infra/docker-compose.yml -f infra/docker-compose.ci.yml down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

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
POSTGRES_USER=fomo
POSTGRES_PASSWORD=password1
POSTGRES_DB=fomo
DATABASE_URL=postgres://fomo:password1@postgres:5432/fomo
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
docker logs fomo-ci-stale-screener | grep -Eq "configuration error|screener stayed stopped"
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

echo "unguarded older image does start paper"
docker build -f infra/legacy-screener.Dockerfile -t fomo-ci-screener:legacy .
legacy_log=$(docker run --rm fomo-ci-screener:legacy)
echo "$legacy_log" | grep -q "without a stop gate"

echo "rollback to the previous gated image"
network=$(docker network ls --format '{{.Name}}' | grep '^fomo-ci' | head -1)
test -n "$network"
rollback_log=$(docker run --rm --network "$network" --env-file "$app_env" -e PAPER_ENABLED=false -e ALERTS_ENABLED=false fomo-ci-screener:previous node apps/screener/dist/main.js)
echo "$rollback_log" | grep -q "screener stayed stopped"

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
