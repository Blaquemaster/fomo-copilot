#!/usr/bin/env bash
# Host command. It is not the app entrypoint, and it refuses to run inside a
# container so an application rollback cannot remove the check.
set -euo pipefail

if [[ -f /.dockerenv ]]; then
  echo "rejected before start: enforcement must run on the host, outside the app image" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
manifest=""
target=""
schema=""
digest=""
project=""
env_file=""
network=""
decide_only=0
execute=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest)
      manifest=$2
      shift 2
      ;;
    --target)
      target=$2
      shift 2
      ;;
    --schema)
      schema=$2
      shift 2
      ;;
    --digest)
      digest=$2
      shift 2
      ;;
    --project)
      project=$2
      shift 2
      ;;
    --env-file)
      env_file=$2
      shift 2
      ;;
    --network)
      network=$2
      shift 2
      ;;
    --decide-only)
      decide_only=1
      shift
      ;;
    --execute)
      execute=1
      shift
      ;;
    *)
      echo "rejected before start: unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$manifest" || -z "$schema" ]]; then
  echo "rejected before start: manifest and schema are required" >&2
  exit 1
fi

if [[ -z "$digest" ]]; then
  if [[ -z "$target" ]]; then
    echo "rejected before start: name a target image" >&2
    exit 1
  fi
  if ! digest=$(docker image inspect --format '{{.Id}}' "$target" 2>/dev/null); then
    echo "rejected before start: target image is not present" >&2
    exit 3
  fi
fi

script_dir=$(cd "$(dirname "$0")" && pwd)
if [[ -f "$script_dir/rollback-decision.mjs" ]]; then
  decision_js=$script_dir/rollback-decision.mjs
else
  decision_js=$root/scripts/rollback-decision.mjs
fi
decision=$(node "$decision_js" --manifest "$manifest" --schema "$schema" --digest "$digest")
action=$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.action)' "$decision")

if [[ "$action" == "reject" ]]; then
  reason=$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.reason)' "$decision")
  echo "rejected before start: $reason" >&2
  exit 3
fi

if [[ "$action" == "stop" ]]; then
  if [[ -n "$project" ]]; then
    mapfile -t running < <(docker ps -q --filter "name=${project}" --filter status=running)
    for id in "${running[@]}"; do
      name=$(docker inspect -f '{{.Name}}' "$id")
      case "$name" in
        *screener* | *alerter* | *outcomes* | *shadow*)
          docker stop "$id" >/dev/null
          ;;
      esac
    done
  fi
  echo "forward fix required: no approved rollback target" >&2
  exit 2
fi

if [[ "$decide_only" == "1" || "$execute" != "1" ]]; then
  echo "$decision"
  exit 0
fi

run_digest=$(node -e 'const value = JSON.parse(process.argv[1]); process.stdout.write(value.imageDigest)' "$decision")
run_args=(docker run --rm)
if [[ -n "$network" ]]; then
  run_args+=(--network "$network")
fi
if [[ -n "$env_file" ]]; then
  run_args+=(--env-file "$env_file")
fi
run_args+=(
  -e PAPER_ENABLED=false
  -e ALERTS_ENABLED=false
  -e OUTCOMES_ENABLED=false
  -e SHADOW_ENABLED=false
  -e INGEST_WIDE_RECOVERY=false
  "$run_digest"
  node apps/screener/dist/main.js
)
"${run_args[@]}"
