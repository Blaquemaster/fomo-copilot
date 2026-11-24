import { readFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function migrationIdsFromSource(source) {
  return [...source.matchAll(/\["(\d{3}_[a-z0-9_]+)"\]/g)].map((match) => match[1]);
}

export function readIdFile(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/** A timeout in migrate() rolls back the whole transaction, not one id. */
export function inventory({ releaseIds, appliedIds }) {
  const applied = new Set(appliedIds);
  return {
    timeoutRollsBack: "whole_batch",
    applied: releaseIds.filter((id) => applied.has(id)),
    pending: releaseIds.filter((id) => !applied.has(id)),
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

function option(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) fail(`missing ${name}`);
  return process.argv[index + 1];
}

if (isMain()) {
  if (process.argv.includes("--host")) fail("inventory does not open a remote host");
  const releaseIds = migrationIdsFromSource(readFileSync(option("--release-source"), "utf8"));
  const appliedIds = readIdFile(readFileSync(option("--applied"), "utf8"));
  process.stdout.write(`${JSON.stringify(inventory({ releaseIds, appliedIds }))}\n`);
}
