import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ConfigError } from "./error.js";
import { loadThresholds } from "./thresholds.js";

const thresholdsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../config/thresholds.yaml",
);

describe("loadThresholds", () => {
  it("accepts the committed Section 7 defaults", () => {
    const thresholds = loadThresholds(thresholdsPath);
    expect(thresholds.screen.first_screen_delay_s).toBe(90);
    expect(thresholds.screen.rescreen_at_min).toEqual([5, 30]);
    expect(thresholds.screen.hard_fail).toEqual({
      mint_authority_active: true,
      freeze_authority_active: true,
      transfer_fee_bps_above: 300,
      exit_quote_impact_pct_above: 5,
      required_source_error: "WATCH",
    });
    expect(thresholds.screen.soft).toEqual({
      top10_holders_pct_warn: 35,
      sniper_bundle_pct_warn: 30,
      min_liquidity_usd: 15000,
      min_unique_makers_1h: 50,
    });
    expect(thresholds.alerts).toEqual({ max_per_hour: 6, quiet_hours: "set-by-me" });
    expect(thresholds.risk_rules).toEqual({
      max_position_usd: "set-by-me",
      max_concurrent_positions: "set-by-me",
      daily_loss_cutoff_usd: "set-by-me",
      no_averaging_down: true,
    });
    expect(thresholds.paper).toEqual({ assumed_slippage_bps: 150, assumed_fee_bps: 50 });
  });

  it("accepts numeric risk rules and a quiet-hours window", () => {
    const file = writeYaml(`
screen:
  first_screen_delay_s: 90
  rescreen_at_min: [5, 30]
  hard_fail:
    mint_authority_active: true
    freeze_authority_active: true
    transfer_fee_bps_above: 300
    exit_quote_impact_pct_above: 5
    required_source_error: WATCH
  soft:
    top10_holders_pct_warn: 35
    sniper_bundle_pct_warn: 30
    min_liquidity_usd: 15000
    min_unique_makers_1h: 50
alerts:
  max_per_hour: 6
  quiet_hours: "22:00-07:00"
risk_rules:
  max_position_usd: 100
  max_concurrent_positions: 2
  daily_loss_cutoff_usd: 50
  no_averaging_down: true
paper:
  assumed_slippage_bps: 150
  assumed_fee_bps: 50
`);
    const thresholds = loadThresholds(file);
    expect(thresholds.alerts.quiet_hours).toBe("22:00-07:00");
    expect(thresholds.risk_rules.max_position_usd).toBe(100);
    expect(thresholds.risk_rules.max_concurrent_positions).toBe(2);
  });

  it("rejects a source error verdict other than WATCH", () => {
    const original = loadThresholds(thresholdsPath);
    const broken = structuredClone(original);
    const file = writeYaml(
      replace(broken, (value) => {
        value.screen.hard_fail.required_source_error = "PASS" as "WATCH";
      }),
    );
    expect(() => loadThresholds(file)).toThrow(ConfigError);
    expect(() => loadThresholds(file)).toThrow(/required_source_error/);
  });

  it("rejects unknown keys and negative delays", () => {
    const original = loadThresholds(thresholdsPath);
    const extra = structuredClone(original) as unknown as Record<string, unknown>;
    extra["surprise"] = true;
    expect(() => loadThresholds(writeYaml(extra))).toThrow(/surprise|unrecognized|invalid/);

    const negative = structuredClone(original);
    negative.screen.first_screen_delay_s = -1;
    expect(() => loadThresholds(writeYaml(negative))).toThrow(/first_screen_delay_s/);
  });

  it("rejects unreadable files without throwing the raw filesystem error object", () => {
    expect(() => loadThresholds("/tmp/fomo-copilot-missing-thresholds.yaml")).toThrow(ConfigError);
  });
});

function writeYaml(value: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fomo-thresholds-"));
  const file = path.join(dir, "thresholds.yaml");
  const text = typeof value === "string" ? value : yamlDump(value);
  writeFileSync(file, text);
  return file;
}

function replace<T>(value: T, edit: (value: T) => void): T {
  edit(value);
  return value;
}

function yamlDump(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
