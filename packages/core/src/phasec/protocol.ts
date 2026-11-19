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

export const EXIT_PLAN =
  "quote-only; stop at the configured percent below entry; measure net return at +1h after the quoted fee and slippage; no add";

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
  feeBps: number;
  slippageBps: number;
  maxPerHour: number;
  promoteRate: number;
  secondWaveMinChangePct: number;
  xEnabled: boolean;
  destination: "test" | "admin";
}

export function defaultSizePct(): Record<Stage, number> {
  return {
    trench: 0.5,
    near_graduation: 1,
    post_graduation: 2,
    second_wave: 1,
  };
}

export function protocolBody(config: PhaseCConfig): string {
  return JSON.stringify({
    version: 1,
    arms: PAPER_ARMS,
    outcome: "net_return_at_1h_after_quoted_costs",
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
    feeBps: config.feeBps,
    slippageBps: config.slippageBps,
    maxPerHour: config.maxPerHour,
    promoteRate: config.promoteRate,
    secondWaveMinChangePct: config.secondWaveMinChangePct,
  });
}

export function parseLockedConfig(body: string): PhaseCConfig {
  return JSON.parse(body) as PhaseCConfig;
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
