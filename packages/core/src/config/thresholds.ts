import { readFileSync } from "node:fs";

import { parse } from "yaml";
import { z } from "zod";

import { ConfigError, formatZodIssues } from "./error.js";

const quietHoursSchema = z.union([
  z.literal("set-by-me"),
  z.literal("off"),
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/),
]);

const usdOrPlaceholder = z.union([
  z.literal("set-by-me"),
  z.number().nonnegative().max(1_000_000_000),
]);

const countOrPlaceholder = z.union([
  z.literal("set-by-me"),
  z.number().int().nonnegative().max(10_000),
]);

const bps = z.number().int().nonnegative().max(10_000);

const percent = z.number().nonnegative().max(100);

export const thresholdsSchema = z.strictObject({
  screen: z.strictObject({
    first_screen_delay_s: z.number().int().positive().max(86_400),
    rescreen_at_min: z.array(z.number().int().positive().max(10_080)).min(1).max(24),
    hard_fail: z.strictObject({
      mint_authority_active: z.boolean(),
      freeze_authority_active: z.boolean(),
      transfer_fee_bps_above: bps,
      exit_quote_impact_pct_above: percent,
      required_source_error: z.literal("WATCH"),
    }),
    soft: z.strictObject({
      top10_holders_pct_warn: percent,
      sniper_bundle_pct_warn: percent,
      min_liquidity_usd: z.number().nonnegative().max(1_000_000_000),
      min_unique_makers_1h: z.number().int().nonnegative().max(1_000_000),
    }),
  }),
  alerts: z.strictObject({
    max_per_hour: z.number().int().positive().max(60),
    quiet_hours: quietHoursSchema,
  }),
  risk_rules: z.strictObject({
    max_position_usd: usdOrPlaceholder,
    max_concurrent_positions: countOrPlaceholder,
    daily_loss_cutoff_usd: usdOrPlaceholder,
    no_averaging_down: z.boolean(),
  }),
  paper: z.strictObject({
    assumed_slippage_bps: bps,
    assumed_fee_bps: bps,
  }),
});

export type Thresholds = z.infer<typeof thresholdsSchema>;

export function loadThresholds(filePath: string): Thresholds {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    throw new ConfigError(`thresholds: unreadable path ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch {
    throw new ConfigError("thresholds: invalid_yaml");
  }

  const parsed = thresholdsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`thresholds: ${formatZodIssues(parsed.error)}`);
  }
  return parsed.data;
}
