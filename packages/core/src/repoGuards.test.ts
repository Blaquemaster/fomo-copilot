import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("repository guards", () => {
  it("gives postgres only its own settings so app env edits do not recreate it", () => {
    const compose = readFileSync(path.join(root, "infra/docker-compose.yml"), "utf8");
    const postgres = compose.split(/^ {2}ingestor:/m)[0] ?? "";
    expect(postgres).toContain("pgdata:/var/lib/postgresql/data");
    expect(postgres).toContain("POSTGRES_USER:");
    expect(postgres).toContain("POSTGRES_PASSWORD:");
    expect(postgres).toContain("POSTGRES_DB:");
    expect(postgres).not.toMatch(/env_file/);
    expect(postgres).not.toMatch(/HELIUS|TELEGRAM|BACKFILL/);
  });

  it("publishes no host ports and does not bind 0.0.0.0", () => {
    const compose = readFileSync(path.join(root, "infra/docker-compose.yml"), "utf8");
    const rootCompose = readFileSync(path.join(root, "compose.yaml"), "utf8");
    expect(compose).not.toMatch(/^\s*ports\s*:/m);
    expect(compose).not.toContain("0.0.0.0");
    expect(compose).not.toMatch(/transactionSubscribe/);
    expect(rootCompose).not.toMatch(/^\s*ports\s*:/m);
  });

  it("gitignores .env and the example file has no token-shaped secret", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.env$/m);
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/);
    expect(example).toContain("TELEGRAM_BOT_TOKEN=");
    expect(example).toContain("TELEGRAM_ADMIN_CHAT_ID=0");
  });

  it("pins dependency versions without ranges", () => {
    for (const file of packageJsonFiles(root)) {
      const manifest = JSON.parse(readFileSync(file, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const section of [manifest.dependencies, manifest.devDependencies]) {
        if (section === undefined) continue;
        for (const [name, version] of Object.entries(section)) {
          expect(version, `${file} ${name}`).toMatch(/^\d+\.\d+\.\d+$/);
        }
      }
    }
  });

  it("installs the host healthcheck without committing its URL", () => {
    const script = readFileSync(path.join(root, "infra/fomo-healthcheck.sh"), "utf8");
    const cron = readFileSync(path.join(root, "infra/fomo-healthcheck.cron"), "utf8");
    const bootstrap = readFileSync(path.join(root, "infra/bootstrap-droplet.sh"), "utf8");
    const runbook = readFileSync(path.join(root, "docs/runbook.md"), "utf8");
    expect(script).toContain(". /etc/fomo-healthcheck.env");
    expect(script).toContain('url="$HC_URL/fail"');
    expect(script).not.toMatch(/https?:\/\//);
    expect(cron).toContain("/usr/local/bin/fomo-healthcheck.sh");
    expect(bootstrap).toContain('install -m 0755 "${script_dir}/fomo-healthcheck.sh"');
    expect(bootstrap).toContain("/etc/cron.d/fomo-healthcheck");
    expect(bootstrap).toContain("0600");
    expect(runbook).toContain("root:root");
    for (const file of textFiles(root)) {
      const body = readFileSync(file, "utf8");
      expect(body, file).not.toMatch(/HC_URL\s*=\s*https?:\/\//);
      expect(body, file).not.toMatch(/https?:\/\/\S*healthchecks\.io/i);
    }
  });

  it("keeps decode-failure and backfill tables in the migration", () => {
    const sql = readFileSync(path.join(root, "packages/core/src/db/ingest.ts"), "utf8");
    expect(sql).toContain("create table if not exists decode_failure");
    expect(sql).toContain("create table if not exists ingest_backfill");
    expect(sql).toContain("002_liveness_backfill");
    expect(sql).toContain("003_unrecovered_gap");
    expect(sql).toContain("004_heap_sample");
    expect(sql).toContain("unrecovered boolean");
    expect(sql).toContain("create table if not exists ingest_heap_sample");
    expect(sql).toContain("gap_seconds");
    expect(sql).toContain("events_recovered");
  });

  it("keeps the deploy workflow on strict host key checking", () => {
    const workflow = readFileSync(path.join(root, ".github/workflows/deploy.yml"), "utf8");
    expect(workflow).toContain("StrictHostKeyChecking=yes");
    expect(workflow).not.toContain("StrictHostKeyChecking=no");
    expect(workflow).not.toContain("0.0.0.0");
    for (const name of [
      "DEPLOY_SSH_KEY",
      "DEPLOY_HOST",
      "DEPLOY_USER",
      "DEPLOY_KNOWN_HOSTS",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_ADMIN_CHAT_ID",
      "HELIUS_API_KEY",
      "POSTGRES_PASSWORD",
    ]) {
      expect(workflow).toContain(name);
    }
  });
});

function textFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...textFiles(full));
      continue;
    }
    if (/\.(ts|js|md|sh|yml|yaml|cron|json|txt)$/.test(entry)) found.push(full);
  }
  return found;
}

function packageJsonFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
    const full = path.join(directory, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      found.push(...packageJsonFiles(full));
    } else if (entry === "package.json") {
      found.push(full);
    }
  }
  return found;
}
