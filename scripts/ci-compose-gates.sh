#!/usr/bin/env bash
# Runs on the CI runner only. It does not contact the production server.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

app_env=$(mktemp)
shadow_env=$(mktemp)
fail_compose=$(mktemp)
trap 'rm -f "$app_env" "$shadow_env" "$fail_compose" ${schema_file:-} ${manifest_file:-} ${empty_manifest:-} ${live_accepted:-} ${wrong_accepted:-}; docker compose --project-name fomo-ci --env-file "$app_env" -f infra/docker-compose.yml -f infra/docker-compose.ci.yml down -v --remove-orphans >/dev/null 2>&1 || true' EXIT

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
AUTOBUY_MODE=dry_run
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

echo "seed read-only preflight evidence"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo <<'SQL'
insert into phasec_config_history (fingerprint, body, recorded_at)
values (
  'cfg-ci',
  '{"effectiveConfig":{"venueAllowlist":["pump"],"walletListVersion":"wallets-ci"}}',
  now()
);
insert into phasec_wallet_list_version (list_hash, recorded_at, wallet_count)
values ('wallets-ci', now(), 1);
insert into phasec_execution (
  mint, group_name, enrolled_at, entry_at, venue, intended_spend_usd, route, run_id
) values (
  'preflight-mint', 'pre_screen', now(), now(), 'pump', 20, 'unknown', 'run-ci'
);
insert into ingest_recall_audit (
  ran_at, program_id, window_start_slot, window_end_slot,
  expected, matched, missed, recovered, decode_failed, credits
) values (now(), 'preflight-probe', 10, 20, 1, 1, 0, 0, 0, 0);
insert into phasec_observation (mint, label, role, due_at, observed_at, status)
values ('preflight-mint', '60m', 'exit', now(), now(), 'stored');
insert into phasec_quote_attempt (mint, label, requested_at, status)
values ('preflight-mint', '60m', now(), 'stored');
insert into phasec_score_shadow (
  id, ranked_count, lookback_start, lookback_end, entry_count, scoring_version, updated_at
) values (
  1, 1, '2026-11-23T00:00:00Z', '2026-11-24T00:00:00Z', 1, 1, now()
);
insert into ingest_status (id, state, ws_method, plan, mode, updated_at)
values (1, 'ok', 'none', 'free', 'dry-run', now());
insert into ingest_recovery_checkpoint (
  program_id, from_slot, to_slot, signatures_seen, finished, recovery_completed_at, recorded_at
) values ('preflight-probe', 1, 1000, 1, true, null, now());
SQL

echo "live preflight probes the CI stack and feeds the checker"
shadow_cid=$(docker ps -q --filter name=fomo-ci --filter name=shadow --filter status=running | head -1)
test -n "$shadow_cid"
live_digest=$(docker inspect -f '{{.Image}}' "$shadow_cid")
live_accepted=$(mktemp)
cat >"$live_accepted" <<EOF
{
  "imageDigest": "${live_digest}",
  "configFingerprint": "cfg-ci",
  "runId": "run-ci",
  "venueScope": ["pump"],
  "walletListVersion": "wallets-ci",
  "wideRecovery": { "flag": "disabled" }
}
EOF
live_log=$(bash scripts/preflight.sh --live \
  --accepted "$live_accepted" \
  --project fomo-ci \
  --env-file "$app_env" \
  --file infra/docker-compose.yml \
  --file infra/docker-compose.ci.yml \
  --service shadow \
  --shadow-user fomo_shadow_ci)
echo "$live_log" | grep -q '"pass":true'
echo "$live_log" | grep -q '"shadowClockStarts":true'
probe_rows=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from phasec_position where mint = 'preflight-probe-deny'")
test "$probe_rows" = "0"
wrong_accepted=$(mktemp)
sed 's/run-ci/run-wrong/' "$live_accepted" >"$wrong_accepted"
set +e
wrong_log=$(bash scripts/preflight.sh --live \
  --accepted "$wrong_accepted" \
  --project fomo-ci \
  --env-file "$app_env" \
  --file infra/docker-compose.yml \
  --file infra/docker-compose.ci.yml \
  --service shadow \
  --shadow-user fomo_shadow_ci 2>&1)
wrong_code=$?
set -e
test "$wrong_code" -ne 0
echo "$wrong_log" | grep -q "run_id"

echo "a permitted shadow write still leaves no row"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo \
  -c "grant insert on phasec_position to fomo_shadow_ci" \
  -c "grant usage, select on sequence phasec_position_id_seq to fomo_shadow_ci"
set +e
permitted_log=$(bash scripts/preflight.sh --live \
  --accepted "$live_accepted" \
  --project fomo-ci \
  --env-file "$app_env" \
  --file infra/docker-compose.yml \
  --file infra/docker-compose.ci.yml \
  --service shadow \
  --shadow-user fomo_shadow_ci 2>&1)
permitted_code=$?
set -e
echo "$permitted_log"
test "$permitted_code" -ne 0
echo "$permitted_log" | grep -q "shadow_permissions"
probe_rows=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from phasec_position where mint = 'preflight-probe-deny'")
test "$probe_rows" = "0"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo \
  -c "revoke insert on phasec_position from fomo_shadow_ci" \
  -c "revoke usage, select on sequence phasec_position_id_seq from fomo_shadow_ci"
rm -f "$live_accepted" "$wrong_accepted"

compose stop shadow

echo "install the rollback controller outside the checkout"
controller_lib=$(mktemp -d)
controller_etc=$(mktemp -d)
DEST_LIB="$controller_lib" DEST_ETC="$controller_etc" bash scripts/install-rollback-controller.sh
test -f "$controller_lib/approved-rollback.sh"
test -f "$controller_lib/rollback-decision.mjs"
grep -q 'forward-fix-only' "$controller_etc/rollback-manifest.json"
schema_ids=$(mktemp)
echo 031_run_identity >"$schema_ids"
set +e
forward_install=$(bash "$controller_lib/approved-rollback.sh" \
  --manifest "$controller_etc/rollback-manifest.json" \
  --schema "$schema_ids" \
  --digest "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd" 2>&1)
forward_install_code=$?
set -e
test "$forward_install_code" -eq 2
echo "$forward_install" | grep -q "forward fix required"
rm -rf "$controller_lib" "$controller_etc"
rm -f "$schema_ids"

echo "rehearse restore and upgrade on an isolated database"
bash scripts/rehearse-upgrade.sh

echo "record the tested ingestor digest"
bash scripts/record-release-digest.sh "$root/release-digest.json"
grep -q 'forward-fix-only' "$root/release-digest.json"

echo "replace only the ingestor and keep postgres"
bash scripts/replace-ingestor.sh --oneshot --project fomo-ci --env-file "$app_env" --record /tmp/fomo-ingestor-replacement.txt
grep -q 'wide_recovery=disabled' /tmp/fomo-ingestor-replacement.txt
grep -q 'result=ok' /tmp/fomo-ingestor-replacement.txt

docker rm -f fomo-ci-stale-screener >/dev/null 2>&1 || true
echo "mock feed for the long-running ingestor"
network=$(docker network ls --format '{{.Name}}' | grep '^fomo-ci' | head -1)
docker run -d --name fomo-ci-mock --network "$network" \
  -v "$root/scripts/ci-mock-feed.mjs:/mock.mjs:ro" \
  node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d \
  node /mock.mjs 8787
cat >>"$app_env" <<EOF
AUTOBUY_MODE=dry_run
HELIUS_HTTP_BASE=http://fomo-ci-mock:8787
HELIUS_WS_BASE=ws://fomo-ci-mock:8787
BSC_WSS_URL=ws://fomo-ci-mock:8787
EOF
set +e
bash scripts/replace-ingestor.sh --live --project fomo-ci --env-file "$app_env" --record /tmp/fomo-live-replacement.txt
live_code=$?
set -e
echo "live replacement exit $live_code"
cat /tmp/fomo-live-trace 2>/dev/null || true
docker logs fomo-ci-ingestor-1 2>&1 || true
test "$live_code" = "0"
grep -q 'result=ok' /tmp/fomo-live-replacement.txt
echo "cutover report while the replacement is up"
running_image=$(docker inspect -f '{{.Image}}' fomo-ci-ingestor-1)
bash scripts/cutover-report.sh \
  --project fomo-ci \
  --env-file "$app_env" \
  --file infra/docker-compose.yml \
  --approved-image "$running_image" \
  --require-image \
  --cutover-at "2026-11-24T00:00:00Z" \
  --diagnostic-start "2026-11-24T00:00:00Z" >/tmp/fomo-cutover.txt
grep -q 'solana_subscription_acks' /tmp/fomo-cutover.txt
grep -q 'bsc_checkpoint' /tmp/fomo-cutover.txt
grep -q 'unrecovered_intervals' /tmp/fomo-cutover.txt
grep -q 'account_usage' /tmp/fomo-cutover.txt
grep -q 'diagnostic_ledger' /tmp/fomo-cutover.txt
grep -q 'warmup 24h' /tmp/fomo-cutover.txt
grep -q 'image_matches_approved yes' /tmp/fomo-cutover.txt
set +e
bash scripts/cutover-report.sh \
  --project fomo-ci \
  --env-file "$app_env" \
  --file infra/docker-compose.yml \
  --approved-image "sha256:0000000000000000000000000000000000000000000000000000000000000000" \
  --require-image >/tmp/fomo-cutover-bad.txt
cutover_bad=$?
set -e
test "$cutover_bad" -ne 0
grep -q 'image_matches_approved no' /tmp/fomo-cutover-bad.txt

echo "diagnostic entrypoint shares the budget and leaves the ingestor running"
role_sql="$root/infra/sql/fomo-shadow-diagnostic.sql"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -f - <"$role_sql"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -f - <"$role_sql"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -c \
  "ALTER ROLE fomo_shadow PASSWORD 'password1'"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select rolsuper::text || rolcreatedb::text || rolcreaterole::text from pg_roles where rolname = 'fomo_shadow'" \
  | grep -qx 'falsefalsefalse'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select has_table_privilege('fomo_shadow','diagnostic_spend','INSERT')::text" | grep -qx 'true'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select has_table_privilege('fomo_shadow','ingest_month','SELECT')::text" | grep -qx 'true'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select has_table_privilege('fomo_shadow','raw_events','INSERT')::text" | grep -qx 'false'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select has_table_privilege('fomo_shadow','phasec_position','INSERT')::text" | grep -qx 'false'
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -c \
  "SET ROLE fomo_shadow; INSERT INTO diagnostic_spend (scope) VALUES ('role-probe') ON CONFLICT DO NOTHING; RESET ROLE;"
mock_counts() {
  docker exec fomo-ci-mock node -e "fetch('http://127.0.0.1:8787/counts').then(async (response) => process.stdout.write(await response.text()))"
}
diagnostic_counts() {
  node --input-type=module -e "const counts = JSON.parse(process.argv[1]); process.stdout.write(JSON.stringify({ scan: counts.scan, publicRpc: counts.publicRpc, jupiter: counts.jupiter }))" "$1"
}
run_diag() {
  docker run --rm --network "$network" \
    --env-file "$app_env" \
    -e POSTGRES_USER="$2" \
    -e DATABASE_URL="$1" \
    -e DIAGNOSTIC_SCOPE="$3" \
    -e DIAGNOSTIC_PROCESS_ID="$4" \
    -e DIAGNOSTIC_MAX_HELIUS_CREDITS="$5" \
    -e DIAGNOSTIC_MAX_JUPITER_QUOTES_PER_DAY="$6" \
    -e DIAGNOSTIC_MAX_PUBLIC_RPC_CALLS_PER_DAY="$7" \
    -e HELIUS_HTTP_BASE=http://fomo-ci-mock:8787 \
    -e PUBLIC_RPC_URL=http://fomo-ci-mock:8787 \
    -e JUPITER_QUOTE_BASE=http://fomo-ci-mock:8787/swap/v1/quote \
    --entrypoint node \
    fomo-ci-ingestor apps/ingestor/dist/diagnostic.js
}
shadow_url="postgres://fomo_shadow:password1@postgres:5432/fomo"
set +e
run_diag "postgres://fomo:password1@postgres:5432/fomo" fomo superuser super 20 2 1 >/tmp/fomo-diag-super.txt
super_code=$?
run_diag "postgres://fomo_shadow_ci:password1@postgres:5432/fomo" fomo_shadow_ci wrongrole wrong 20 2 1 >/tmp/fomo-diag-wrong.txt
wrong_code=$?
set -e
cat /tmp/fomo-diag-super.txt
cat /tmp/fomo-diag-wrong.txt
test "$super_code" -ne 0
test "$wrong_code" -ne 0
grep -q '"roleRefused":true' /tmp/fomo-diag-super.txt
grep -q '"roleRefused":true' /tmp/fomo-diag-wrong.txt
grep -q '"sent":{"scan":0,"reconciliation":0,"quote":0}' /tmp/fomo-diag-super.txt
grep -q '"sent":{"scan":0,"reconciliation":0,"quote":0}' /tmp/fomo-diag-wrong.txt
run_diag "$shadow_url" fomo_shadow shared a 20 2 1 >/tmp/fomo-diag-a.txt &
diag_a=$!
run_diag "$shadow_url" fomo_shadow shared b 20 2 1 >/tmp/fomo-diag-b.txt &
diag_b=$!
set +e
wait "$diag_a"
diag_a_code=$?
wait "$diag_b"
diag_b_code=$?
set -e
cat /tmp/fomo-diag-a.txt
cat /tmp/fomo-diag-b.txt
test "$diag_a_code" = "0"
test "$diag_b_code" = "0"
grep -q '"role":"fomo_shadow"' /tmp/fomo-diag-a.txt
grep -q 'apps/ingestor/dist/diagnostic.js' /tmp/fomo-diag-a.txt
grep -q '"ingestor":"keeps_running"' /tmp/fomo-diag-a.txt
grep -q '"countDays":false' /tmp/fomo-diag-a.txt
shared_counts=$(mock_counts)
echo "shared counts $shared_counts"
node --input-type=module -e "
const counts = JSON.parse(process.argv[1]);
if (counts.scan !== 1 || counts.publicRpc !== 1 || counts.jupiter !== 2 || counts.lastScanBudget !== 10000) {
  console.error(counts);
  process.exit(1);
}
" "$shared_counts"
shared_spend=$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select helius_credits::text || ',' || jupiter_quotes::text || ',' || public_rpc_calls::text from diagnostic_spend where scope = 'shared'")
echo "shared spend $shared_spend"
test "$shared_spend" = "20,2,1"
shared_methods=$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select string_agg(distinct method, ',' order by method) from diagnostic_spend_event where scope = 'shared' and accepted and method <> 'parsedEventsScanReconcile'")
echo "shared methods $shared_methods"
test "$shared_methods" = "getSignaturesForAddress,parsedEventsScan,quote"
reconciled=$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -At -c \
  "select count(*) from diagnostic_spend_event where scope = 'shared' and method = 'parsedEventsScanReconcile'")
test "$reconciled" = "1"
run_diag "$shadow_url" fomo_shadow shared c 20 2 1 >/tmp/fomo-diag-c.txt
cat /tmp/fomo-diag-c.txt
grep -q '"denied":3' /tmp/fomo-diag-c.txt
test "$(diagnostic_counts "$(mock_counts)")" = "$(diagnostic_counts "$shared_counts")"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -c \
  "insert into diagnostic_spend (scope, helius_credits, jupiter_quotes, public_rpc_calls, spent_usd_micros) values ('denied', 20, 2, 1, 0)"
run_diag "$shadow_url" fomo_shadow denied d 20 2 1 >/tmp/fomo-diag-d.txt
cat /tmp/fomo-diag-d.txt
grep -q '"sent":{"scan":0,"reconciliation":0,"quote":0}' /tmp/fomo-diag-d.txt
test "$(diagnostic_counts "$(mock_counts)")" = "$(diagnostic_counts "$shared_counts")"
run_diag "postgres://fomo_shadow:password1@127.0.0.1:1/fomo" fomo_shadow missing e 20 2 1 >/tmp/fomo-diag-e.txt
cat /tmp/fomo-diag-e.txt
grep -q '"budgetDbFailed":true' /tmp/fomo-diag-e.txt
test "$(diagnostic_counts "$(mock_counts)")" = "$(diagnostic_counts "$shared_counts")"
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo -c \
  "insert into ingest_month (month, credit_micros, paused) values (to_char(now() at time zone 'utc', 'YYYY-MM'), 9000000000000, true) on conflict (month) do update set credit_micros = excluded.credit_micros, paused = true"
run_diag "$shadow_url" fomo_shadow pause f 100 5 5 >/tmp/fomo-diag-f.txt
cat /tmp/fomo-diag-f.txt
grep -q '"failure":"integrity"' /tmp/fomo-diag-f.txt
grep -q '"diagnosticCreditsRemaining":80' /tmp/fomo-diag-f.txt
grep -q '"countDays":false' /tmp/fomo-diag-f.txt
test "$(docker inspect -f '{{.State.Running}}' fomo-ci-ingestor-1)" = "true"
pause_counts=$(mock_counts)
node --input-type=module -e "
const before = JSON.parse(process.argv[1]);
const after = JSON.parse(process.argv[2]);
if (after.baselineWs < 1) process.exit(1);
if (after.scan <= before.scan) process.exit(1);
" "$shared_counts" "$pause_counts"
echo "diagnostic budget held; ingestor still running"

compose stop ingestor
docker rm -f fomo-ci-mock >/dev/null 2>&1 || true

echo "startup failure preserves the database"
rows_before=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from raw_events")
set +e
bash scripts/replace-ingestor.sh --expect-failure --project fomo-ci --env-file "$app_env" --record /tmp/fomo-failed-replacement.txt
fail_code=$?
set -e
test "$fail_code" -ne 0
grep -q 'result=failed' /tmp/fomo-failed-replacement.txt
rows_after=$(compose exec -T postgres psql -U fomo -d fomo -At -c "select count(*) from raw_events")
test "$rows_after" = "$rows_before"

echo "restore a pre-upgrade backup and apply 023-031 before dispatch"
pre_dump=$(mktemp)
compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d postgres \
  -c "drop database if exists fomo_pre_upgrade" \
  -c "create database fomo_pre_upgrade"
{
  echo "create table schema_migrations (id text primary key);"
  grep -v '^#' infra/db/production-baseline.txt | grep -v '^$' | while read -r id; do
    echo "insert into schema_migrations (id) values ('$id');"
  done
} | compose exec -T postgres psql -v ON_ERROR_STOP=1 -U fomo -d fomo_pre_upgrade
compose exec -T postgres pg_dump -U fomo -d fomo_pre_upgrade -Fc >"$pre_dump"
bash scripts/restore-and-upgrade.sh --dump "$pre_dump" --database fomo_cutover --project fomo-ci --env-file "$app_env"
rm -f "$pre_dump"

echo "schema drift halts before migrations"
bash scripts/halt-on-schema-drift.sh --applied infra/db/production-baseline.txt
drifted=$(mktemp)
grep -v '^022_' infra/db/production-baseline.txt >"$drifted"
set +e
drift_log=$(bash scripts/halt-on-schema-drift.sh --applied "$drifted" 2>&1)
drift_code=$?
set -e
test "$drift_code" -ne 0
echo "$drift_log" | grep -q "schema drift"
rm -f "$drifted"

echo "copy the tested OCI archive without rebuilding"
if ! command -v skopeo >/dev/null 2>&1; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq skopeo
fi
test -s "$root/release-oci.tar"
recorded_digest=$(node --input-type=module -e "import {readFileSync} from 'node:fs'; process.stdout.write(JSON.parse(readFileSync(process.argv[1],'utf8')).registryDigest)" "$root/release-digest.json")
echo "publish the image to a local registry and verify the pulled id"
docker rm -f fomo-ci-registry >/dev/null 2>&1 || true
docker run -d --name fomo-ci-registry -p 127.0.0.1:5000:5000 registry:2
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:5000/v2/ >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:5000/v2/ >/dev/null
docker tag fomo-ci-ingestor 127.0.0.1:5000/fomo-ingestor:tested
docker push 127.0.0.1:5000/fomo-ingestor:tested
published_headers=$(mktemp)
published_code=$(curl -sS -D "$published_headers" -o /dev/null -w '%{http_code}' \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
  http://127.0.0.1:5000/v2/fomo-ingestor/manifests/tested || true)
published=$(awk 'tolower($1)=="docker-content-digest:" { print $2 }' "$published_headers" | tr -d '\r')
rm -f "$published_headers"
if [[ "$published_code" != "200" || -z "$published" ]]; then
  echo "local registry manifest request failed HTTP ${published_code}" >&2
  exit 1
fi
test -n "$published"
expected_id=$(docker image inspect --format '{{.Id}}' fomo-ci-ingestor)
verify_log=$(bash scripts/verify-published-image.sh \
  --reference "127.0.0.1:5000/fomo-ingestor@${published}" \
  --expected-image-id "$expected_id")
echo "$verify_log" | grep -q "platform=linux/amd64"
echo "$verify_log" | grep -q "replacement may start"
copy_log=$(bash scripts/copy-tested-oci.sh \
  --archive "$root/release-oci.tar" \
  --destination "127.0.0.1:5000/fomo-ingestor:copied" \
  --expected "$recorded_digest" \
  --scheme http)
echo "$copy_log"
echo "$copy_log" | grep -q "digest unchanged ${recorded_digest}"
bash scripts/verify-release-handoff.sh \
  --archive "$root/release-oci.tar" \
  --handoff "$root/release-handoff.json" \
  --run-id "${GITHUB_RUN_ID:-local}" \
  --artifact-id pending-upload
tampered=$(mktemp)
printf 'altered' >"$tampered"
set +e
tamper_log=$(bash scripts/verify-release-handoff.sh \
  --archive "$tampered" \
  --handoff "$root/release-handoff.json" \
  --run-id "${GITHUB_RUN_ID:-local}" \
  --artifact-id pending-upload 2>&1)
tamper_code=$?
set -e
test "$tamper_code" -ne 0
echo "$tamper_log" | grep -q "checksum does not match"
set +e
wrong_log=$(bash scripts/verify-release-handoff.sh \
  --archive "$root/release-oci.tar" \
  --handoff "$root/release-handoff.json" \
  --run-id 1 \
  --artifact-id pending-upload 2>&1)
wrong_code=$?
missing_handoff=$(bash scripts/verify-release-handoff.sh \
  --archive "$root/release-oci.tar" \
  --handoff "$root/release-oci.tar.missing" \
  --run-id "${GITHUB_RUN_ID:-local}" \
  --artifact-id pending-upload 2>&1)
missing_handoff_code=$?
set -e
test "$wrong_code" -ne 0
test "$missing_handoff_code" -ne 0
echo "$wrong_log" | grep -q "different run"
rm -f "$tampered"
docker pull "127.0.0.1:5000/fomo-ingestor@${recorded_digest}"
echo "digest-pinned pull matches ${recorded_digest}"
docker tag node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d \
  127.0.0.1:5000/fomo-ingestor:rebuilt
docker push 127.0.0.1:5000/fomo-ingestor:rebuilt
rebuilt_headers=$(mktemp)
rebuilt_code=$(curl -sS -D "$rebuilt_headers" -o /dev/null -w '%{http_code}' \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json" \
  http://127.0.0.1:5000/v2/fomo-ingestor/manifests/rebuilt || true)
rebuilt=$(awk 'tolower($1)=="docker-content-digest:" { print $2 }' "$rebuilt_headers" | tr -d '\r')
rm -f "$rebuilt_headers"
if [[ "$rebuilt_code" != "200" || -z "$rebuilt" ]]; then
  echo "rebuilt manifest request failed HTTP ${rebuilt_code}" >&2
  exit 1
fi
set +e
rebuild_log=$(bash scripts/verify-published-image.sh \
  --reference "127.0.0.1:5000/fomo-ingestor@${rebuilt}" \
  --expected-image-id "$expected_id" 2>&1)
rebuild_code=$?
set -e
test "$rebuild_code" -ne 0
echo "$rebuild_log" | grep -q "must not be substituted"
set +e
missing_log=$(bash scripts/verify-published-image.sh \
  --reference "127.0.0.1:5000/fomo-ingestor@sha256:0000000000000000000000000000000000000000000000000000000000000000" \
  --expected-image-id "$expected_id" 2>&1)
missing_code=$?
set -e
test "$missing_code" -ne 0
echo "$missing_log" | grep -q "pull failed"
docker rm -f fomo-ci-registry >/dev/null 2>&1 || true

echo "one-time deploy user"
deploy_dir=$(mktemp -d)
deploy_key="$deploy_dir/id_ed25519"
ssh-keygen -t ed25519 -f "$deploy_key" -N '' -q
root_before=""
if sudo test -f /root/.ssh/authorized_keys; then
  root_before=$(sudo sha256sum /root/.ssh/authorized_keys | awk '{print $1}')
fi
sudo bash scripts/setup-deploy-user.sh "${deploy_key}.pub"
sudo bash scripts/setup-deploy-user.sh "${deploy_key}.pub"
id fomo-deploy | grep -q 'fomo-deploy'
if id -nG fomo-deploy | tr ' ' '\n' | grep -qx docker; then
  echo "deploy user must not be in the docker group" >&2
  exit 1
fi
sudo passwd -S fomo-deploy | awk '{ exit ($2 == "L" ? 0 : 1) }'
sudo grep -Fq 'NOPASSWD: /usr/local/lib/fomo/fomo-deploy-helper' /etc/sudoers.d/fomo-deploy
sudo cmp -s "${deploy_key}.pub" /home/fomo-deploy/.ssh/authorized_keys
test "$(stat -c '%U' /usr/local/lib/fomo/fomo-deploy-helper)" = "root"
sudo -u fomo-deploy test -w /usr/local/lib/fomo/fomo-deploy-helper && exit 1
sudo -u fomo-deploy test -w /etc/fomo/deploy-authorization.json && exit 1
set +e
sudo -u fomo-deploy docker ps >/tmp/fomo-deploy-docker.txt 2>&1
docker_code=$?
set -e
test "$docker_code" -ne 0
if [[ -n "$root_before" ]]; then
  test "$(sudo sha256sum /root/.ssh/authorized_keys | awk '{print $1}')" = "$root_before"
fi
sudo -n true
docker volume create fomo-copilot_pgdata >/dev/null
docker rm -f fomo-rehearse-postgres >/dev/null 2>&1 || true
docker create --name fomo-rehearse-postgres \
  --label com.docker.compose.project=fomo-copilot \
  --label com.docker.compose.service=postgres \
  postgres:16.14-bookworm@sha256:64154d0babcb1741988719e703419af0382b19953706149f9872fbd0f438efa8 \
  postgres >/dev/null
sudo tee /etc/fomo/deploy-authorization.json >/dev/null <<'EOF'
{
  "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "composeProject": "fomo-copilot"
}
EOF
sudo chmod 644 /etc/fomo/deploy-authorization.json
rehearse=$(sudo -u fomo-deploy bash -lc 'cd /tmp && COMPOSE_PROJECT_NAME=evil DOCKER_HOST=tcp://127.0.0.1:9 sudo -n /usr/local/lib/fomo/fomo-deploy-helper rehearse')
echo "$rehearse"
echo "$rehearse" | grep -qx 'docker_context=default' || echo "$rehearse" | grep -q 'docker_context=default'
echo "$rehearse" | grep -q 'compose_project=fomo-copilot'
echo "$rehearse" | grep -q 'postgres_volume=fomo-copilot_pgdata'
echo "$rehearse" | grep -q 'postgres_container=present'
echo "$rehearse" | grep -q 'postgres_volume_present=yes'
echo "$rehearse" | grep -q 'rehearse targets the existing postgres stack'
echo "$rehearse" | grep -q 'diagnostic-start'
status=$(sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper diagnostic-status)
echo "$status" | grep -q 'diagnostic_container=absent'
set +e
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper rehearse extra >/tmp/fomo-helper-extra.txt 2>&1
extra_code=$?
sudo -u fomo-deploy sudo -n /usr/local/lib/fomo/fomo-deploy-helper bash >/tmp/fomo-helper-bash.txt 2>&1
bash_code=$?
set -e
test "$extra_code" -ne 0
test "$bash_code" -ne 0
set +e
bash scripts/setup-deploy-user.sh "${deploy_key}.pub" >/tmp/fomo-deploy-unprivileged.txt 2>&1
unprivileged=$?
set -e
test "$unprivileged" -ne 0
grep -q 'only root step' /tmp/fomo-deploy-unprivileged.txt
rm -rf "$deploy_dir"
node scripts/check-deploy-triggers.mjs
bash scripts/hold-deploy-workflow.sh --fixture-disabled >/dev/null
set +e
bash scripts/hold-deploy-workflow.sh --fixture-enabled >/tmp/fomo-hold.txt 2>&1
hold_code=$?
set -e
test "$hold_code" -ne 0
candidate_tree=$(git rev-parse 'HEAD^{tree}')
bash scripts/check-merged-tree.sh --tree "$candidate_tree" --ref HEAD >/dev/null
set +e
bash scripts/check-merged-tree.sh --tree 0000000000000000000000000000000000000000 --ref HEAD >/tmp/fomo-tree.txt 2>&1
tree_code=$?
set -e
test "$tree_code" -ne 0

echo "abort when a deploy is already queued"
bash scripts/pre-merge-deploy-check.sh
bash scripts/verify-release-pins.sh

echo "compose gates passed"
