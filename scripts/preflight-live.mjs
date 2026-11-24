import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { evaluatePreflight } from "./preflight-check.mjs";

const RECONCILE_MAX_SECONDS = 6 * 60 * 60 + 10 * 60;
const FRESH_MAX_SECONDS = 180;
const PROBE_MINT = "preflight-probe-deny";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

export function shapeObserved(raw) {
  let venues = null;
  let configWallet = null;
  if (typeof raw.configBody === "string" && raw.configBody.length > 0) {
    try {
      const body = JSON.parse(raw.configBody);
      const allowlist = body?.effectiveConfig?.venueAllowlist;
      venues = Array.isArray(allowlist) ? allowlist : null;
      configWallet = body?.effectiveConfig?.walletListVersion ?? null;
    } catch {
      venues = null;
    }
  }
  const tableWallet = typeof raw.walletListHash === "string" ? raw.walletListHash : null;
  const walletListVersion =
    configWallet && tableWallet && configWallet === tableWallet ? configWallet : null;
  const runIds = Array.isArray(raw.runIds) ? raw.runIds.filter((value) => value) : [];
  const recall = raw.recall ?? null;
  const recallOk =
    !!recall && recall.skipped !== true && recall.errored !== true && recall.incomplete !== true;
  const cursorAdvanced = !!recall && Number(recall.end) > Number(recall.start);
  const observationStored = !!raw.observation;
  const services = [];
  if (recallOk) services.push("ingestor");
  if (observationStored) services.push("outcomes");
  const lookbackComplete =
    typeof raw.lookbackStart === "string" &&
    typeof raw.lookbackEnd === "string" &&
    raw.lookbackStart.length > 0 &&
    raw.lookbackEnd >= raw.lookbackStart;
  const reconcileMax = raw.reconcileMaxSeconds ?? RECONCILE_MAX_SECONDS;
  const freshMax = raw.freshMaxSeconds ?? FRESH_MAX_SECONDS;
  const referenceReconciliation =
    recallOk && recall.age !== null && Number(recall.age) <= reconcileMax ? "running" : "stopped";
  const freshness =
    raw.statusAge !== null && raw.statusAge !== undefined && Number(raw.statusAge) <= freshMax
      ? "running"
      : "stopped";
  const maxEvidenceAge = raw.maxEvidenceAgeSeconds ?? 900;
  const ages = [raw.configAge, raw.recall?.age, raw.observationAge, raw.statusAge].filter(
    (value) => value !== null && value !== undefined,
  );
  const evidenceStale = ages.some((value) => Number(value) > maxEvidenceAge);
  return {
    imageDigest: raw.imageId ?? null,
    boundImageDigest: raw.imageId ?? null,
    imageDigests: raw.imageDigests ?? {},
    configFingerprint: raw.configFingerprint ?? null,
    boundConfigFingerprint: raw.configFingerprint ?? null,
    evidenceStale,
    runId: runIds.length === 1 ? runIds[0] : null,
    venueScope: venues,
    walletListVersion,
    shadowPermissions: {
      prohibitedWritesDenied: raw.writeDenied === true && raw.writeRolledBack === true,
    },
    reconciliationCycle: {
      ran: recallOk,
      services,
      cursorAdvanced,
      observationStored,
    },
    lookbackComplete,
    schedules: { referenceReconciliation, freshness },
    wideRecovery: {
      flag: raw.wideRecoveryEnv === "true" ? "enabled" : "disabled",
      gapHandling: Number(raw.wideCompleted) > 0 ? "recovered" : "unrecovered",
    },
  };
}

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function composeArgs(project, envFile, files) {
  const args = ["compose", "--project-name", project];
  if (envFile) args.push("--env-file", envFile);
  for (const file of files) args.push("-f", file);
  return args;
}

function run(command, args, input) {
  return execFileSync(command, args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function psql(args, user, sql) {
  return run("docker", [
    ...args,
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    user,
    "-d",
    "fomo",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ]).trim();
}

function shadowWrite(args, user) {
  const sql = [
    "BEGIN;",
    `INSERT INTO phasec_position (mint, stage, arm, status, alert_at, entry_after, size_pct, exit_plan)`,
    `VALUES ('${PROBE_MINT}', 'post_graduation', 'wallets_x_screen', 'pending', now(), now(), 0, 'none');`,
    "ROLLBACK;",
  ].join("\n");
  let denied = false;
  try {
    run(
      "docker",
      [
        ...args,
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        user,
        "-d",
        "fomo",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      sql,
    );
  } catch (error) {
    const stderr = `${error?.stderr ?? ""}\n${error?.stdout ?? ""}`;
    denied = /permission denied/i.test(stderr);
    if (!denied) fail(stderr || "shadow permission probe failed");
  }
  const count = psql(
    args,
    "fomo",
    `select count(*) from phasec_position where mint = '${PROBE_MINT}'`,
  );
  return { writeDenied: denied, writeRolledBack: count === "0" };
}

const FACTS_SQL = `
select json_build_object(
  'configFingerprint', (select fingerprint from phasec_config_history order by recorded_at desc limit 1),
  'configBody', (select body from phasec_config_history order by recorded_at desc limit 1),
  'configAge', (select extract(epoch from (now() - recorded_at)) from phasec_config_history order by recorded_at desc limit 1),
  'observationAge', (
    select extract(epoch from (now() - observed_at))
    from phasec_observation
    where status <> 'pending' and observed_at is not null
    order by observed_at desc
    limit 1
  ),
  'runIds', coalesce((select json_agg(distinct run_id) from phasec_execution where run_id is not null), '[]'::json),
  'walletListHash', (select list_hash from phasec_wallet_list_version order by recorded_at desc limit 1),
  'recall', (
    select json_build_object(
      'start', window_start_slot,
      'end', window_end_slot,
      'skipped', skipped,
      'errored', errored,
      'incomplete', incomplete,
      'age', extract(epoch from (now() - ran_at))
    )
    from ingest_recall_audit
    order by ran_at desc
    limit 1
  ),
  'observation', (
    select json_build_object('mint', o.mint, 'label', o.label)
    from phasec_observation o
    join phasec_quote_attempt a on a.mint = o.mint and a.label = o.label
    where o.status <> 'pending' and o.observed_at is not null
    limit 1
  ),
  'lookbackStart', (select lookback_start from phasec_score_shadow where id = 1),
  'lookbackEnd', (select lookback_end from phasec_score_shadow where id = 1),
  'statusAge', (select extract(epoch from (now() - updated_at)) from ingest_status where id = 1),
  'wideCompleted', (
    select count(*) from ingest_recovery_checkpoint
    where (to_slot - from_slot) > 600 and recovery_completed_at is not null
  )
)::text
`;

function runningContainers(project) {
  const text = run("docker", [
    "ps",
    "--filter",
    `name=${project}`,
    "--filter",
    "status=running",
    "--format",
    "{{.ID}}\t{{.Names}}",
  ]).trim();
  if (!text) return [];
  return text.split("\n").map((line) => {
    const [id, name] = line.split("\t");
    return { id, name };
  });
}

function inspectContainer(id) {
  const imageId = run("docker", ["inspect", "-f", "{{.Image}}", id]).trim();
  const envText = run("docker", ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", id]);
  const wide = envText.split("\n").find((line) => line.startsWith("INGEST_WIDE_RECOVERY="));
  return { imageId, wideRecoveryEnv: wide ? wide.slice("INGEST_WIDE_RECOVERY=".length) : "unset" };
}

function gather(options) {
  const files = options.files.length > 0 ? options.files : ["infra/docker-compose.yml"];
  const args = composeArgs(options.project, options.envFile, files);
  const containers = runningContainers(options.project);
  const imageDigests = {};
  let imageId = null;
  let wideRecoveryEnv = "unset";
  let sawEnabled = false;
  for (const container of containers) {
    const inspected = inspectContainer(container.id);
    imageDigests[container.name] = inspected.imageId;
    if (container.name.includes(`-${options.service}-`)) imageId = inspected.imageId;
    if (inspected.wideRecoveryEnv === "true") sawEnabled = true;
    else if (container.name.includes(`-${options.service}-`)) {
      wideRecoveryEnv = inspected.wideRecoveryEnv;
    }
  }
  if (sawEnabled) wideRecoveryEnv = "true";
  const facts = JSON.parse(psql(args, "fomo", FACTS_SQL));
  const write = shadowWrite(args, options.shadowUser);
  return shapeObserved({
    ...facts,
    imageId,
    imageDigests,
    wideRecoveryEnv,
    ...write,
    reconcileMaxSeconds: options.reconcileMaxSeconds,
    freshMaxSeconds: options.freshMaxSeconds,
  });
}

function main() {
  if (process.argv.includes("--host")) fail("preflight does not open a remote host");
  if (process.argv.includes("--fixture")) {
    const raw = JSON.parse(readFileSync(option("--fixture"), "utf8"));
    const observed = shapeObserved(raw);
    const accepted = JSON.parse(readFileSync(option("--accepted"), "utf8"));
    const result = evaluatePreflight(accepted, observed);
    process.stdout.write(`${JSON.stringify({ observed, result })}\n`);
    if (!result.pass) process.exit(1);
    return;
  }
  const project = option("--project");
  const acceptedPath = option("--accepted");
  if (!project || !acceptedPath) fail("preflight --live needs --project and --accepted");
  const files = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--file" && process.argv[index + 1])
      files.push(process.argv[index + 1]);
  }
  const observed = gather({
    project,
    envFile: option("--env-file"),
    files,
    service: option("--service", "ingestor"),
    shadowUser: option("--shadow-user", "fomo_shadow"),
    reconcileMaxSeconds: Number(option("--reconcile-seconds", String(RECONCILE_MAX_SECONDS))),
    freshMaxSeconds: Number(option("--fresh-seconds", String(FRESH_MAX_SECONDS))),
  });
  const accepted = JSON.parse(readFileSync(acceptedPath, "utf8"));
  const result = evaluatePreflight(accepted, observed);
  process.stdout.write(`${JSON.stringify({ observed, result })}\n`);
  if (!result.pass) process.exit(1);
}

if (isMain()) main();
