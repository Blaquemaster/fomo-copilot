#!/usr/bin/env bash
# Read-only preflight. The file mode compares two JSON files. The live mode
# reads the local docker socket and the compose database, then feeds that
# report to the same checker. It does not use sudo and it does not open a
# remote host. Do not point it at production from this repository change.
set -euo pipefail

if [[ -f /.dockerenv ]]; then
  echo "preflight runs on the host, without sudo" >&2
  exit 1
fi

root=$(cd "$(dirname "$0")/.." && pwd)
accepted=""
observed=""
live=0
project=""
env_file=""
service="ingestor"
shadow_user="fomo_shadow"
files=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --accepted)
      accepted=$2
      shift 2
      ;;
    --observed)
      observed=$2
      shift 2
      ;;
    --live)
      live=1
      shift
      ;;
    --project)
      project=$2
      shift 2
      ;;
    --env-file)
      env_file=$2
      shift 2
      ;;
    --service)
      service=$2
      shift 2
      ;;
    --shadow-user)
      shadow_user=$2
      shift 2
      ;;
    --file)
      files+=("$2")
      shift 2
      ;;
    --host)
      echo "preflight does not open a remote host" >&2
      exit 1
      ;;
    *)
      echo "unknown preflight argument" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$accepted" ]]; then
  echo "preflight needs --accepted" >&2
  exit 1
fi

if [[ "$live" == "1" ]]; then
  if [[ -z "$project" ]]; then
    echo "preflight --live needs --project" >&2
    exit 1
  fi
  args=(
    node "$root/scripts/preflight-live.mjs"
    --accepted "$accepted"
    --project "$project"
    --service "$service"
    --shadow-user "$shadow_user"
  )
  if [[ -n "$env_file" ]]; then
    args+=(--env-file "$env_file")
  fi
  if [[ ${#files[@]} -eq 0 ]]; then
    files=("infra/docker-compose.yml")
  fi
  for file in "${files[@]}"; do
    args+=(--file "$file")
  done
  "${args[@]}"
  exit 0
fi

if [[ -z "$observed" ]]; then
  echo "preflight needs --observed, or --live with --project" >&2
  exit 1
fi

node "$root/scripts/preflight-check.mjs" --accepted "$accepted" --observed "$observed"
