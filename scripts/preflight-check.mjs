import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function sameList(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function evaluatePreflight(accepted, observed) {
  const reasons = [];
  if (observed?.imageDigest !== accepted?.imageDigest) reasons.push("image_digest");
  if (observed?.configFingerprint !== accepted?.configFingerprint) reasons.push("config");
  if (observed?.runId !== accepted?.runId) reasons.push("run_id");
  if (!sameList(observed?.venueScope, accepted?.venueScope)) reasons.push("venue_scope");
  if (observed?.walletListVersion !== accepted?.walletListVersion) {
    reasons.push("wallet_list_version");
  }
  if (observed?.shadowPermissions?.prohibitedWritesDenied !== true) {
    reasons.push("shadow_permissions");
  }
  const cycle = observed?.reconciliationCycle;
  if (
    !cycle ||
    cycle.ran !== true ||
    cycle.cursorAdvanced !== true ||
    cycle.observationStored !== true
  ) {
    reasons.push("reconciliation_cycle");
  }
  const services = Array.isArray(cycle?.services) ? cycle.services : [];
  if (!services.includes("ingestor") || !services.includes("outcomes")) {
    reasons.push("reconciliation_services");
  }
  if (observed?.lookbackComplete !== true) reasons.push("lookback");
  if (observed?.schedules?.referenceReconciliation !== "running") {
    reasons.push("schedule_reconciliation");
  }
  if (observed?.schedules?.freshness !== "running") reasons.push("schedule_freshness");
  if (accepted?.wideRecovery?.flag !== "disabled") reasons.push("wide_recovery_manifest");
  if (
    observed?.wideRecovery?.flag !== "disabled" ||
    observed?.wideRecovery?.gapHandling !== "unrecovered"
  ) {
    reasons.push("wide_recovery_gap");
  }
  return {
    pass: reasons.length === 0,
    reasons,
    shadowClockStarts: reasons.length === 0,
  };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) fail(`missing ${name}`);
  return process.argv[index + 1];
}

if (isMain()) {
  if (process.argv.includes("--host") || process.argv.includes("--live")) {
    fail("preflight file check does not contact a host; use scripts/preflight.sh --live");
  }
  const accepted = JSON.parse(readFileSync(arg("--accepted"), "utf8"));
  const observed = JSON.parse(readFileSync(arg("--observed"), "utf8"));
  const result = evaluatePreflight(accepted, observed);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.pass) process.exit(1);
}
