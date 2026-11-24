import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function source(relative: string): string {
  return readFileSync(path.join(root, relative), "utf8");
}

describe("stopped state survives a workflow revert", () => {
  it("gates every paper, alert, outcome, and shadow process in the application", () => {
    expect(source("apps/screener/src/main.ts")).toContain("serviceEnabled(env.PAPER_ENABLED)");
    expect(source("apps/alerter/src/main.ts")).toContain("serviceEnabled(env.ALERTS_ENABLED)");
    expect(source("apps/screener/src/outcomeWorker.ts")).toContain(
      "serviceEnabled(env.OUTCOMES_ENABLED)",
    );
    expect(source("apps/screener/src/shadowWorker.ts")).toContain(
      "serviceEnabled(env.SHADOW_ENABLED)",
    );
    const deploy = source(".github/workflows/deploy.yml");
    expect(deploy).toContain("stop screener alerter");
    expect(deploy).not.toContain("shadow");
    const compose = source("infra/docker-compose.yml");
    expect(compose).toContain('profiles: ["outcomes"]');
    expect(compose).toContain('profiles: ["shadow"]');
    expect(compose).toContain('profiles: ["paper"]');
    const shadow = compose.split(/^ {2}shadow:/m)[1]?.split(/^ {2}[a-z]/m)[0] ?? "";
    expect(shadow).toContain("shadow.env");
    expect(shadow).not.toContain("../.env");
    expect(source("apps/screener/src/shadowWorker.ts")).toContain("telegramToken");
    expect(source("apps/ingestor/src/loop.ts")).not.toContain("referenceCheckPlan");
    expect(source(".github/workflows/deploy.yml")).toContain("stop screener alerter");
  });
});
