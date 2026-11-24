import { PROVEN_WALLET_RULE, SCORING_VERSION } from "../ingest/wallets.js";
import { EXPERIMENT_PROTOCOL } from "./experimentProtocol.js";

/** Frozen at the first screener pass. A later config change does not retune a running test. */

export const ET = "America/New_York";

export const STAGES = ["trench", "near_graduation", "post_graduation", "second_wave"] as const;
export type Stage = (typeof STAGES)[number];

export const PAPER_ARMS = [
  "screen_only",
  "wallets_x_screen",
  "random_pass",
  "second_wave_a",
  "second_wave_b",
] as const;
export type PaperArm = (typeof PAPER_ARMS)[number];

export const EXIT_TREATMENTS = ["fixed_horizon", "scale_out"] as const;
export type ExitTreatment = (typeof EXIT_TREATMENTS)[number];

export const SCALE_OUT_PLAN =
  "scale out half the position at +50% quoted, remainder at +1h or the stop; no add";

export const EXIT_PLAN = SCALE_OUT_PLAN;

/** Weights locked with the registration. X is optional and adds nothing when it is absent. */
export const SCORE_WEIGHTS = {
  base: 0.35,
  postGrad: 0.2,
  nearGrad: 0.1,
  oneBuyer: 0.2,
  threeBuyers: 0.1,
  xMentions: 0.15,
  liquidity: 0.1,
} as const;

export function assignExitTreatment(mint: string): ExitTreatment {
  return mintBucket(mint, 2) === 0 ? "fixed_horizon" : "scale_out";
}

export const TRENCH_MAX_AGE_MIN = 360;
export const POST_GRAD_MINUTES = 30;

export interface PhaseCConfig {
  bankroll: number | null;
  sizePct: Record<Stage, number>;
  dailyLossCutoffPct: number;
  maxConcurrent: number;
  quietHours: string;
  quietPostGradMinStrength: number;
  quietPostGradMinSizePct: number;
  exitStopPct: number;
  entryDelaySec: number;
  horizonMs: number;
  paperWindowDays: number;
  paperMinAlerts: number;
  paperMaxDrawdownPct: number;
  maxPerHour: number;
  promoteRate: number;
  secondWaveMinChangePct: number;
  marketPollMinutes: number;
  xEnabled: boolean;
  destination: "test" | "admin";
  fomoFeeSchedule: "solana_lowest_fee" | "solana_other" | "fixed_usd";
  /** Fixed dollars per transaction when the schedule is fixed_usd. Default 0.95. */
  txCostUsd?: number;
  otherMinUsd?: number;
  otherRate?: number;
  /** Consecutive true no-route answers required before a -100% dead close. Default 3. */
  deadNoRouteStreak?: number;
  /** Minimum spacing between those answers. Default 60 seconds. */
  deadNoRouteGapMs?: number;
  /** Immediate buy-then-sell loss, in percent, that skips the fill. Default 10. */
  maxRoundTripImpactPct?: number;
  /** Position size may not exceed this share of pool liquidity. Default 0.01. */
  maxSizePoolShare?: number;
  /** Scale-out is off unless this is exactly true. The accounting function stays. */
  scaleOutEnabled?: boolean;
  /** When set, every stage uses this dollar size. Graduated coins are not sized larger. */
  fixedNotionalUsd?: number;
  /** Adopted experiment defaults: graduated pools, no stop, unfilled entry is zero. */
  experimentProtocol?: boolean;
  /** False disables the price stop. Undefined keeps the older paper stop. */
  stopsEnabled?: boolean;
  /** Venues accepted for a match. Empty means none are validated yet. */
  venueAllowlist?: readonly string[];
  /** Set when the experiment config contradicts the frozen protocol. */
  configRefused?: string | null;
}

export function defaultSizePct(): Record<Stage, number> {
  return {
    trench: 0.5,
    near_graduation: 1,
    post_graduation: 2,
    second_wave: 1,
  };
}

export function protocolBody(config: PhaseCConfig, rules?: unknown): string {
  return JSON.stringify({
    screen: rules ?? null,
    version: 1,
    arms: PAPER_ARMS,
    sizePct: config.sizePct,
    dailyLossCutoffPct: config.dailyLossCutoffPct,
    maxConcurrent: config.maxConcurrent,
    quietHours: config.quietHours,
    quietPostGradMinStrength: config.quietPostGradMinStrength,
    quietPostGradMinSizePct: config.quietPostGradMinSizePct,
    exitStopPct: config.exitStopPct,
    entryDelaySec: config.entryDelaySec,
    horizonMs: config.horizonMs,
    paperWindowDays: config.paperWindowDays,
    paperMinAlerts: config.paperMinAlerts,
    paperMaxDrawdownPct: config.paperMaxDrawdownPct,
    maxPerHour: config.maxPerHour,
    promoteRate: config.promoteRate,
    secondWaveMinChangePct: config.secondWaveMinChangePct,
    marketPollMinutes: config.marketPollMinutes,
    weights: SCORE_WEIGHTS,
    exitTreatments: EXIT_TREATMENTS,
    fomoFeeSchedule: config.fomoFeeSchedule,
    txCostUsd: config.txCostUsd ?? 0.95,
    otherMinUsd: config.otherMinUsd ?? 0.95,
    otherRate: config.otherRate ?? 0.005,
    deadNoRouteStreak: config.deadNoRouteStreak ?? 3,
    deadNoRouteGapMs: config.deadNoRouteGapMs ?? 60_000,
    maxRoundTripImpactPct: config.maxRoundTripImpactPct ?? 10,
    maxSizePoolShare: config.maxSizePoolShare ?? 0.01,
    scaleOutEnabled: config.scaleOutEnabled === true,
    fixedNotionalUsd: config.fixedNotionalUsd ?? null,
    walletCohort: "exploratory_activity_graduation_selected",
    parserVersion: "fill-v3",
    excludedProtocol: "c1d34366",
    voidedPositions: 79,
    experiment: EXPERIMENT_PROTOCOL,
    experimentProtocol: config.experimentProtocol === true,
    stopsEnabled: config.stopsEnabled !== false,
    scoringVersion: SCORING_VERSION,
    walletMinEntries: PROVEN_WALLET_RULE.minEntries,
    sniperUnmeasured: "watch_until_measured",
    outcome: "bankroll_pnl_at_1h_after_quoted_costs_and_fomo_fee",
    goRule:
      "strategy arms only: positive bankroll pnl after quoted costs and FOMO fees, min alerts, drawdown under the locked percent, still profitable without the best trade, median net above zero",
  });
}

export function parseLockedConfig(body: string): PhaseCConfig {
  const parsed = JSON.parse(body) as PhaseCConfig & { config?: PhaseCConfig };
  return parsed.config ?? parsed;
}

export function protocolFingerprint(body: string): string {
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function mintBucket(mint: string, mod: number): number {
  let hash = 2166136261;
  for (let index = 0; index < mint.length; index += 1) {
    hash ^= mint.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return mod <= 0 ? 0 : (hash >>> 0) % mod;
}
