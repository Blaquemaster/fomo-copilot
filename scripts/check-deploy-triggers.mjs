import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const workflowDir = path.resolve(".github/workflows");
const markers = [
  "deploy-production",
  "promote-tested-digest",
  "publish-tested-artifact",
  "oci-archive:",
];
const forbidden = [
  "push",
  "pull_request",
  "workflow_run",
  "workflow_call",
  "repository_dispatch",
  "schedule",
];

function onBlock(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === "on:");
  if (start < 0) return "";
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Za-z]/.test(line)) break;
    block.push(line);
  }
  return block.join("\n");
}

let failed = false;
const files = readdirSync(workflowDir).filter(
  (name) => name.endsWith(".yml") || name.endsWith(".yaml"),
);
for (const name of files) {
  const text = readFileSync(path.join(workflowDir, name), "utf8");
  const deploys = markers.some((marker) => text.includes(marker));
  if (deploys) {
    const triggers = onBlock(text);
    for (const trigger of forbidden) {
      if (new RegExp(`^\\s*${trigger}:\\s*$`, "m").test(triggers)) {
        process.stderr.write(
          `${name} would deploy through ${trigger}. Only workflow_dispatch may reach main.\n`,
        );
        failed = true;
      }
    }
  }
  if (name !== "deploy.yml" && /uses:\s+\.\/\.github\/workflows\/deploy\.yml/.test(text)) {
    process.stderr.write(`${name} calls the deploy workflow.\n`);
    failed = true;
  }
  if (/workflow:\s*deploy\.yml/.test(text) || /gh workflow run deploy/.test(text)) {
    process.stderr.write(`${name} starts the deploy workflow indirectly.\n`);
    failed = true;
  }
}
if (failed) process.exit(1);
process.stdout.write("no direct or indirect deploy trigger\n");
