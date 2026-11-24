#!/usr/bin/env bash
# Bounded ingestor replacement. The image must already exist.
# --oneshot migrates and exits. The owner command without --oneshot is
# compose up -d --no-deps --no-build ingestor.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
oneshot=0
project=${COMPOSE_PROJECT_NAME:-fomo-ci}
app_env=${CI_APP_ENV:-}
record=${REPLACEMENT_RECORD:-/tmp/fomo-ingestor-replacement.txt}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --oneshot)
      oneshot=1
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

postgres_id=$(docker ps -q --filter "name=${project}" --filter name=postgres --filter status=running | head -1)
test -n "$postgres_id"
before=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from ingest_checkpoint" || echo 0)
interrupted_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ "$oneshot" == "1" ]]; then
  compose run --rm --no-deps --entrypoint node ingestor \
    apps/ingestor/dist/main.js --spot-check
else
  compose up -d --no-deps --no-build ingestor
fi

after_id=$(docker ps -q --filter "name=${project}" --filter name=postgres --filter status=running | head -1)
test "$after_id" = "$postgres_id"
after=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from ingest_checkpoint" || echo 0)
cat >"$record" <<EOF
interrupted_at=$interrupted_at
postgres_id=$postgres_id
checkpoints_before=$before
checkpoints_after=$after
wide_recovery=disabled
reconciliation=unrecovered_gaps_stay_recorded
EOF
echo "ingestor replacement recorded in $record"
