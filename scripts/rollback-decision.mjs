import { readFileSync } from "node:fs";
import process from "node:process";

const REQUIRED_EVIDENCE = ["verify", "compose-gates"];

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isApproved(target, appliedMigrations) {
  if (
    !target ||
    typeof target.imageDigest !== "string" ||
    !target.imageDigest.startsWith("sha256:")
  ) {
    return false;
  }
  if (target.gateTestsPassed !== true) return false;
  const evidence = Array.isArray(target.evidence) ? target.evidence : [];
  if (!REQUIRED_EVIDENCE.every((name) => evidence.includes(name))) return false;
  const schema = Array.isArray(target.schemaRequirements) ? target.schemaRequirements : [];
  if (schema.length === 0 || !schema.every((id) => appliedMigrations.includes(id))) return false;
  const modes = target.permittedModes;
  if (!modes || modes.paper !== false || modes.alerts !== false) return false;
  if (modes.wideRecovery !== false) return false;
  if (!Array.isArray(target.permittedServices) || target.permittedServices.length === 0)
    return false;
  return true;
}

/**
 * Age and builtAt are ignored. A target is approved only when the digest,
 * schema, modes, and gate evidence all match.
 */
export function evaluateRollback({ manifest, requestedDigest, appliedMigrations }) {
  const targets = Array.isArray(manifest?.targets) ? manifest.targets : [];
  const servicesToStop = Array.isArray(manifest?.affectedServices)
    ? manifest.affectedServices
    : ["screener", "alerter", "outcomes", "shadow"];
  const approved = targets.filter((target) => isApproved(target, appliedMigrations));
  if (approved.length === 0) {
    return {
      action: "stop",
      reason: "no approved fallback",
      forwardFix: true,
      servicesToStop,
    };
  }
  if (!requestedDigest) {
    if (approved.length === 1) {
      return start(approved[0]);
    }
    return {
      action: "reject",
      reason: "explicit digest required",
      beforeStart: true,
    };
  }
  const match = approved.find((target) => target.imageDigest === requestedDigest);
  if (!match) {
    return {
      action: "reject",
      reason: "target not in approved rollback manifest",
      beforeStart: true,
    };
  }
  return start(match);
}

function start(target) {
  return {
    action: "start",
    reason: "approved fallback",
    beforeStart: false,
    imageDigest: target.imageDigest,
    permittedServices: target.permittedServices,
    permittedModes: target.permittedModes,
  };
}

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) fail(`missing ${name}`);
  return process.argv[index + 1];
}

const manifest = JSON.parse(readFileSync(arg("--manifest"), "utf8"));
const schemaText = readFileSync(arg("--schema"), "utf8");
const appliedMigrations = schemaText
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
const digestFlag = process.argv.indexOf("--digest");
const requestedDigest = digestFlag === -1 ? "" : (process.argv[digestFlag + 1] ?? "");
const decision = evaluateRollback({
  manifest,
  requestedDigest,
  appliedMigrations,
});
process.stdout.write(`${JSON.stringify(decision)}\n`);
