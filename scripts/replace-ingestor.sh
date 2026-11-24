#!/usr/bin/env bash
# Bounded ingestor replacement. The image must already exist.
# --oneshot migrates and exits. The owner command without --oneshot is
# compose up -d --no-deps --no-build ingestor.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
oneshot=0
live=0
expect_failure=0
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:-}
record=${REPLACEMENT_RECORD:-/tmp/fomo-ingestor-replacement.txt}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --oneshot)
      oneshot=1
      shift
      ;;
    --live)
      live=1
      shift
      ;;
    --expect-failure)
      expect_failure=1
      shift
      ;;
    --project)
      project=$2
      shift 2
      ;;
    --env-file)
      app_env=$2
      shift 2
      ;;
    --record)
      record=$2
      shift 2
      ;;
    *)
      echo "unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$app_env" ]]; then
  echo "replace-ingestor needs --env-file" >&2
  exit 1
fi

compose() {
  docker compose --project-name "$project" --env-file "$app_env" \
    -f infra/docker-compose.yml -f infra/docker-compose.ci.yml "$@"
}

postgres_id=$(docker ps -q --filter "name=${project}-postgres-" --filter status=running)
test -n "$postgres_id"
before=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from ingest_checkpoint" || echo 0)
interrupted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

marker=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from raw_events" || echo 0)

if [[ "$expect_failure" == "1" ]]; then
  override=$(mktemp)
  cat >"$override" <<'EOF'
services:
  ingestor:
    restart: "no"
    command: ["node", "apps/ingestor/dist/main.js", "--crash-test"]
EOF
  set +e
  compose -f "$override" up -d --no-deps --no-build ingestor
  for _ in $(seq 1 20); do
    status=$(docker inspect -f '{{.State.Status}}' "${project}-ingestor-1" 2>/dev/null || echo missing)
    if [[ "$status" == "exited" ]]; then
      break
    fi
    sleep 1
  done
  set -e
  status=$(docker inspect -f '{{.State.Status}}' "${project}-ingestor-1" 2>/dev/null || echo missing)
  after_id=$(docker ps -q --filter "name=${project}-postgres-" --filter status=running)
  after_marker=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from raw_events" || echo 0)
  cat >"$record" <<EOF
result=failed
interrupted_at=$interrupted_at
postgres_id=$postgres_id
postgres_after=$after_id
raw_events_before=$marker
raw_events_after=$after_marker
container=$status
EOF
  rm -f "$override"
  if [[ "$after_id" != "$postgres_id" || "$after_marker" != "$marker" || "$status" != "exited" ]]; then
    echo "replacement failure did not preserve the database" >&2
    exit 1
  fi
  echo "ingestor replacement failed and the database was preserved"
  exit 1
fi

if [[ "$oneshot" == "1" ]]; then
  compose run --rm --no-deps --entrypoint node ingestor \
    apps/ingestor/dist/main.js --spot-check
elif [[ "$live" == "1" ]]; then
  trace=/tmp/fomo-live-trace
  echo "live branch" >"$trace"
  set +e
  compose up -d --no-deps --no-build ingestor
  echo "up exit $?" >>"$trace"
  healthy=0
  for _ in $(seq 1 40); do
    status=$(docker inspect -f '{{.State.Status}}' "${project}-ingestor-1" 2>/dev/null || echo missing)
    if [[ "$status" == "exited" ]]; then
      break
    fi
    if compose logs ingestor 2>/dev/null | grep -q "starting helius ingest"; then
      rows=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from raw_events" 2>/dev/null || echo 0)
      rows=${rows//$'\n'/}
      if [[ "$rows" -gt "$marker" ]]; then
        healthy=1
        break
      fi
    fi
    sleep 1
  done
  set -e
  if [[ "$healthy" != "1" ]]; then
    compose logs ingestor >&2 || true
    echo "ingestor did not persist a mock event marker=$marker"
    exit 1
  fi
  status=$(docker inspect -f '{{.State.Status}}' "${project}-ingestor-1")
  if [[ "$status" != "running" ]]; then
    docker logs "${project}-ingestor-1" >&2 || true
    echo "ingestor status $status" >&2
    exit 1
  fi
  env_text=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "${project}-ingestor-1")
  echo "$env_text" | grep 'AUTOBUY_MODE' || true
  echo "$env_text" | grep -q 'AUTOBUY_MODE=dry_run'
  running=$(docker ps --format '{{.Names}}' | grep -E '(^|-)(screener|alerter|outcomes|shadow)(-|$)' || true)
  echo "paper services: ${running:-none}"
  test -z "$running"
else
  compose up -d --no-deps --no-build ingestor
fi

after_id=$(docker ps -q --filter "name=${project}-postgres-" --filter status=running)
echo "postgres before ${postgres_id} after ${after_id}"
test "$after_id" = "$postgres_id"
after=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from ingest_checkpoint" || echo 0)
cat >"$record" <<EOF
result=ok
interrupted_at=$interrupted_at
postgres_id=$postgres_id
checkpoints_before=$before
checkpoints_after=$after
wide_recovery=disabled
reconciliation=unrecovered_gaps_stay_recorded
EOF
echo "ingestor replacement recorded in $record"
