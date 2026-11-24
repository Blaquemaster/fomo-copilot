#!/usr/bin/env bash
# Read-only cutover watch list. Prints what the host and database have recorded.
# Does not write, migrate, or restart anything.
set -euo pipefail

project=fomo-copilot
env_file=.env
compose_file=infra/docker-compose.yml
service=ingestor
approved=""
cutover=""
diagnostic_start=""
require_image=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      project=$2
      shift 2
      ;;
    --env-file)
      env_file=$2
      shift 2
      ;;
    --file)
      compose_file=$2
      shift 2
      ;;
    --service)
      service=$2
      shift 2
      ;;
    --approved-image)
      approved=$2
      shift 2
      ;;
    --cutover-at)
      cutover=$2
      shift 2
      ;;
    --diagnostic-start)
      diagnostic_start=$2
      shift 2
      ;;
    --require-image)
      require_image=true
      shift
      ;;
    *)
      echo "unknown argument" >&2
      exit 1
      ;;
  esac
done

if [[ -n "$cutover" && ! "$cutover" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-Z]+$ ]]; then
  echo "cutover-at must be an ISO timestamp" >&2
  exit 1
fi
if [[ -n "$diagnostic_start" && ! "$diagnostic_start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.+-Z]+$ ]]; then
  echo "diagnostic-start must be an ISO timestamp" >&2
  exit 1
fi

psqlq() {
  docker compose --project-name "$project" --env-file "$env_file" -f "$compose_file" \
    exec -T postgres psql -U fomo -d fomo -At -c "$1" 2>/dev/null || true
}

section() {
  echo
  echo "## $1"
}

echo "cutover report $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "read only"

section "subscription acks, reconnects, parse errors, checkpoints"
container=$(docker ps -aq --filter "name=${project}-${service}-" || true)
container=${container%%$'\n'*}
if [[ -n "$container" ]]; then
  echo "container $container"
  echo "restart_count $(docker inspect -f '{{.RestartCount}}' "$container")"
  echo "started_at $(docker inspect -f '{{.State.StartedAt}}' "$container")"
  logs=$(docker logs "$container" 2>&1 || true)
  echo "solana_subscription_acks $(printf '%s\n' "$logs" | grep -c 'subscription confirmed' || true)"
  echo "solana_reconnects_logged $(printf '%s\n' "$logs" | grep -c 'reconnect' || true)"
  echo "bsc_subscription_acks $(printf '%s\n' "$logs" | grep -c 'bsc flap subscription started' || true)"
  echo "bsc_reconnects_logged $(printf '%s\n' "$logs" | grep -c 'bsc reconnect' || true)"
else
  echo "container not recorded"
fi
echo "solana_lifecycle_status"
psqlq "select coalesce(state,'') || ' slot=' || coalesce(last_slot::text,'') || ' coverage=' || coalesce(coverage_slot::text,'') || ' error=' || coalesce(last_error,'') from ingest_status where id = 1"
echo "solana_checkpoints"
psqlq "select program_id || ' slot=' || slot::text || ' at=' || updated_at::text from ingest_checkpoint order by program_id"
echo "solana_venue_coverage"
psqlq "select venue || ' slot=' || coverage_slot::text || ' at=' || updated_at::text from ingest_venue_coverage order by venue"
echo "tracked_wallets"
psqlq "select 'active=' || count(*) filter (where active)::text || ' inactive=' || count(*) filter (where not active)::text from tracked_wallet"
echo "wallet_backfill"
psqlq "select status || '=' || count(*)::text from wallet_backfill_mint group by status order by status"
echo "wallet_job"
psqlq "select 'finished_at=' || coalesce(finished_at::text,'not recorded') from wallet_job where id = 1"
echo "bsc_checkpoint"
psqlq "select 'block=' || block_number::text || ' coverage=' || coalesce(coverage_block::text,'') || ' reconnects=' || reconnects::text || ' at=' || updated_at::text from ingest_chain_checkpoint where chain = 'bsc'"
echo "parse_errors"
psqlq "select count(*)::text from decode_failure"

section "cutover timestamps"
if [[ -z "$cutover" ]]; then
  echo "last_pre_cutover_checkpoint not recorded"
  echo "first_post_cutover_event not recorded"
else
  echo "cutover_at $cutover"
  echo -n "last_pre_cutover_checkpoint "
  psqlq "select coalesce(max(updated_at)::text,'not recorded') from ingest_checkpoint where updated_at < timestamptz '${cutover}'"
  echo -n "first_post_cutover_event "
  psqlq "select coalesce(min(received_at)::text,'not recorded') from raw_events where received_at >= timestamptz '${cutover}'"
fi
echo -n "recovery_completion "
psqlq "select coalesce(max(recovery_completed_at)::text,'not recorded') from ingest_backfill"
echo "unrecovered_intervals"
psqlq "select id::text || ' ' || program_id || ' ' || coalesce(gap_from_slot::text,'') || '-' || coalesce(gap_to_slot::text,'') || ' ' || coalesce(reason,'') || ' at=' || observed_at::text from ingest_backfill where unrecovered order by id"

section "locks, lag, disk, connections"
echo "migration_locks"
psqlq "select locktype || ' ' || mode || ' granted=' || granted::text from pg_locks where not granted"
echo -n "ingestion_lag_seconds "
psqlq "select coalesce(extract(epoch from (now() - max(received_at)))::bigint::text,'not recorded') from raw_events"
echo -n "disk "
df -B1 / | awk 'NR==2 { printf "used=%s avail=%s\n", $3, $4 }'
echo -n "connection_error "
psqlq "select coalesce(nullif(last_error,''),'not recorded') from ingest_status where id = 1"

section "running image and diagnostic role"
image_ok=false
if [[ -n "$container" ]]; then
  image=$(docker inspect -f '{{.Image}}' "$container")
  repo_digests=$(docker image inspect -f '{{join .RepoDigests " "}}' "$image" 2>/dev/null || true)
  echo "running_image $image"
  echo "repo_digests ${repo_digests:-not recorded}"
  if [[ -n "$approved" && ("$image" == "$approved" || "$repo_digests" == *"$approved"*) ]]; then
    image_ok=true
    echo "image_matches_approved yes"
  elif [[ -n "$approved" ]]; then
    echo "image_matches_approved no"
  else
    echo "approved_image not recorded"
  fi
else
  echo "running_image not recorded"
fi
echo "diagnostic_sessions"
psqlq "select coalesce(string_agg(distinct usename, ','), 'not recorded') from pg_stat_activity where usename = 'fomo_shadow'"

section "scan reservation versus reported pages"
echo "scan_events"
psqlq "select method || ' units=' || units::text || ' accepted=' || accepted::text || ' at=' || created_at::text from diagnostic_spend_event where method like 'parsedEventsScan%' order by id"

section "helius account usage separate from the diagnostic ledger"
echo "account_usage"
psqlq "select month || ' micros=' || credit_micros::text || ' paused=' || paused::text from ingest_month order by month"
echo "diagnostic_ledger"
psqlq "select scope || ' helius=' || helius_credits::text || ' jupiter=' || jupiter_quotes::text || ' rpc=' || public_rpc_calls::text || ' usd_micros=' || spent_usd_micros::text from diagnostic_spend order by scope"

section "warm-up and diagnostic window"
if [[ -z "$diagnostic_start" ]]; then
  echo "warmup not recorded"
  echo "diagnostic_window not recorded"
else
  echo "diagnostic_start $diagnostic_start"
  echo "warmup 24h from the diagnostic start"
  echo "diagnostic_window 7d after the warm-up ends"
fi

if [[ "$require_image" == true && "$image_ok" != true ]]; then
  echo "sequence stopped: running image is not the approved digest" >&2
  exit 1
fi
echo
echo "cutover report complete"
