import { fomoFeeUsd, type FomoFeeSchedule } from "./quote.js";

/**
 * Reviewer answers adopted as the protocol defaults. The route actually charged
 * is still not known. The $150 cap is a proposal and is not approval to buy a service.
 */
export const EXPERIMENT_ALLOCATED_USD = 20;
export const EXPERIMENT_ENTRY_DELAY_SEC = 180;
export const EXPERIMENT_ENTRY_DELAY_MS = EXPERIMENT_ENTRY_DELAY_SEC * 1000;
export const EXPERIMENT_HORIZON_MS = 60 * 60 * 1000;
export const EXPERIMENT_LATENESS_MS = 3 * 60 * 1000;
export const EXPERIMENT_ENROLLMENT_WINDOW_MS = 30 * 60 * 1000;
export const EXPERIMENT_WALLET_LOOKBACK_MS = 60 * 60 * 1000;
export const EXPERIMENT_MIN_ADVANTAGE = 0.05;
export const EXPERIMENT_WINDOW_DAYS = 60;
export const EXPERIMENT_RESEARCH_CAP_USD = 150;
export const EXPERIMENT_ROUND_TRIP_CAP_PCT = 10;
export const DIAGNOSTIC_DELAYS_MS = [15, 30, 45].map((minutes) => minutes * 60 * 1000);

export const EXPERIMENT_PROTOCOL = {
  stage: "freshly_graduated",
  venue: "one_validated_venue_which_is_not_known",
  notionalUsd: EXPERIMENT_ALLOCATED_USD,
  entryDelaySec: EXPERIMENT_ENTRY_DELAY_SEC,
  horizonMs: EXPERIMENT_HORIZON_MS,
  latenessMs: EXPERIMENT_LATENESS_MS,
  diagnosticMinutes: [15, 30, 45],
  enrollmentWindowMs: EXPERIMENT_ENROLLMENT_WINDOW_MS,
  walletLookbackMs: EXPERIMENT_WALLET_LOOKBACK_MS,
  stops: false,
  takeProfit: false,
  roundTripCapPct: EXPERIMENT_ROUND_TRIP_CAP_PCT,
  minAdvantage: EXPERIMENT_MIN_ADVANTAGE,
  windowDays: EXPERIMENT_WINDOW_DAYS,
  researchCapUsd: EXPERIMENT_RESEARCH_CAP_USD,
  researchCapStatus: "proposal_needs_owner_approval",
  controlRatio: 1,
  primaryStress: "both_high",
  shadowMinDays: 7,
  shadowMaxDays: 14,
} as const;

/** Signal time is the first moment the needed facts were actually in hand. */
export function enrollmentTimeline(input: { graduatedAt: Date; infoReceivedAt: Date }): {
  eligible: boolean;
  reason: string | null;
  signalAt: Date;
  enrolledAt: Date;
  entryAt: Date;
} {
  const signalAt = new Date(Math.max(input.graduatedAt.getTime(), input.infoReceivedAt.getTime()));
  const windowEnd = input.graduatedAt.getTime() + EXPERIMENT_ENROLLMENT_WINDOW_MS;
  const eligible = signalAt.getTime() <= windowEnd;
  return {
    eligible,
    reason: eligible ? null : "outside_graduation_window",
    signalAt,
    enrolledAt: signalAt,
    entryAt: new Date(signalAt.getTime() + EXPERIMENT_ENTRY_DELAY_MS),
  };
}

/** The buy must have been observed before enrollment, inside the preceding 60 minutes. */
export function walletBuyQualifies(input: { observedAt: Date; enrolledAt: Date }): boolean {
  const ageMs = input.enrolledAt.getTime() - input.observedAt.getTime();
  return ageMs >= 0 && ageMs <= EXPERIMENT_WALLET_LOOKBACK_MS;
}

/**
 * The exit is the first valid quote at or after the 60-minute deadline, and at most
 * 3 minutes late. Anything later is a recovery diagnostic and does not fill the exit.
 */
export function classifyExitObservation(input: {
  entryAt: Date;
  observedAt: Date;
  valid: boolean;
}): { usableAsExit: boolean; late: boolean; holdMs: number | null } {
  const deadline = input.entryAt.getTime() + EXPERIMENT_HORIZON_MS;
  if (!input.valid || input.observedAt.getTime() < deadline) {
    return { usableAsExit: false, late: false, holdMs: null };
  }
  if (input.observedAt.getTime() - deadline > EXPERIMENT_LATENESS_MS) {
    return { usableAsExit: false, late: true, holdMs: null };
  }
  return {
    usableAsExit: true,
    late: false,
    holdMs: input.observedAt.getTime() - input.entryAt.getTime(),
  };
}

/** Return on the $20 that was set aside. Unfilled is 0. Unresolved is missing, not 0. */
export function allocatedReturn(input: {
  kind: "unfilled" | "unresolved" | "filled";
  exitCashUsd?: number;
  allocatedUsd?: number;
}): number | null {
  const allocated = input.allocatedUsd ?? EXPERIMENT_ALLOCATED_USD;
  if (!(allocated > 0)) return null;
  if (input.kind === "unfilled") return 0;
  if (input.kind === "unresolved" || input.exitCashUsd === undefined) return null;
  return input.exitCashUsd / allocated - 1;
}

export function pairedDifferences(
  pairs: readonly { wallet: number | null; control: number | null }[],
): { mean: number | null; complete: number; missing: number } {
  const diffs = pairs.map((pair) =>
    pair.wallet === null || pair.control === null ? null : pair.wallet - pair.control,
  );
  const complete = diffs.filter((diff): diff is number => diff !== null);
  return {
    mean:
      complete.length === 0
        ? null
        : complete.reduce((sum, diff) => sum + diff, 0) / complete.length,
    complete: complete.length,
    missing: diffs.length - complete.length,
  };
}

/** Flat price: buy fee out of the $20, then the same schedule on the way out. */
export function flatRoundTrip(
  schedule: FomoFeeSchedule,
  allocated = EXPERIMENT_ALLOCATED_USD,
): {
  entryFeeUsd: number;
  tokenCashUsd: number;
  exitFeeUsd: number;
  exitCashUsd: number;
  returnOnAllocated: number;
} {
  const entryFeeUsd = fomoFeeUsd(allocated, schedule);
  const tokenCashUsd = allocated - entryFeeUsd;
  const exitFeeUsd = fomoFeeUsd(tokenCashUsd, schedule);
  const exitCashUsd = tokenCashUsd - exitFeeUsd;
  return {
    entryFeeUsd,
    tokenCashUsd,
    exitFeeUsd,
    exitCashUsd,
    returnOnAllocated: exitCashUsd / allocated - 1,
  };
}

export function returnForMove(
  schedule: FomoFeeSchedule,
  exitOverEntry: number,
  allocated = EXPERIMENT_ALLOCATED_USD,
): number {
  const entryFeeUsd = fomoFeeUsd(allocated, schedule);
  const tokenCashUsd = allocated - entryFeeUsd;
  const exitGrossUsd = tokenCashUsd * exitOverEntry;
  const exitFeeUsd = fomoFeeUsd(exitGrossUsd, schedule);
  return (exitGrossUsd - exitFeeUsd) / allocated - 1;
}

/** Three reports. Adverse is wallet-high and control-low. None of them is a known route. */
export function threeScenarios(input: { walletMultiple: number; controlMultiple: number }): {
  bothHigh: number;
  bothLow: number;
  adverse: number;
} {
  const walletHigh = returnForMove("solana_other", input.walletMultiple);
  const walletLow = returnForMove("solana_lowest_fee", input.walletMultiple);
  const controlHigh = returnForMove("solana_other", input.controlMultiple);
  const controlLow = returnForMove("solana_lowest_fee", input.controlMultiple);
  return {
    bothHigh: walletHigh - controlHigh,
    bothLow: walletLow - controlLow,
    adverse: walletHigh - controlLow,
  };
}

export interface StratumCoin {
  mint: string;
  venue: string;
  liquidityUsd: number | null;
  minutesSinceGraduation: number;
  hourUtc: number;
}

export function liquidityBand(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "unknown";
  if (usd < 15_000) return "under_15k";
  if (usd < 50_000) return "15k_50k";
  return "50k_plus";
}

export function ageBand(minutes: number): string {
  if (minutes < 10) return "0_10";
  if (minutes < 20) return "10_20";
  return "20_30";
}

function drawKey(mint: string, now: Date): number {
  const text = `${now.toISOString()}:${mint}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function levelKey(coin: StratumCoin, level: 0 | 1 | 2 | 3): string {
  const venue = coin.venue;
  const liquidity = liquidityBand(coin.liquidityUsd);
  const age = ageBand(coin.minutesSinceGraduation);
  if (level === 0) return `${venue}|${liquidity}|${age}|${coin.hourUtc.toString()}`;
  if (level === 1) return `${venue}|${liquidity}|${age}`;
  if (level === 2) return `${venue}|${liquidity}`;
  return venue;
}

const FALLBACK = ["stratum", "drop_hour", "drop_age", "venue_only"] as const;

/**
 * One screened control per wallet coin. A control is never reused or replaced.
 * An empty stratum falls through a fixed list and otherwise stays unmatched.
 */
export function matchOneToOne(input: {
  wallets: readonly StratumCoin[];
  screened: readonly StratumCoin[];
  now: Date;
}): {
  pairs: Array<{ wallet: string; control: string; fallback: (typeof FALLBACK)[number] }>;
  unmatched: string[];
  dispatch: string[];
} {
  const used = new Set<string>();
  const pairs: Array<{ wallet: string; control: string; fallback: (typeof FALLBACK)[number] }> = [];
  const unmatched: string[] = [];
  for (const wallet of input.wallets) {
    let chosen: { mint: string; fallback: (typeof FALLBACK)[number] } | null = null;
    for (let level = 0; level < FALLBACK.length; level += 1) {
      const key = levelKey(wallet, level as 0 | 1 | 2 | 3);
      const pool = input.screened
        .filter((coin) => !used.has(coin.mint) && levelKey(coin, level as 0 | 1 | 2 | 3) === key)
        .sort((left, right) => drawKey(left.mint, input.now) - drawKey(right.mint, input.now));
      const first = pool[0];
      if (first) {
        chosen = { mint: first.mint, fallback: FALLBACK[level] ?? "venue_only" };
        break;
      }
    }
    if (!chosen) {
      unmatched.push(wallet.mint);
      continue;
    }
    used.add(chosen.mint);
    pairs.push({ wallet: wallet.mint, control: chosen.mint, fallback: chosen.fallback });
  }
  const dispatch = pairs
    .flatMap((pair) => [pair.wallet, pair.control])
    .sort((left, right) => drawKey(left, input.now) - drawKey(right, input.now));
  return { pairs, unmatched, dispatch };
}

/** Separate from the matched control. Same count, hash order, coins not already used. */
export function drawBenchmark(input: {
  coins: readonly { mint: string }[];
  exclude: ReadonlySet<string>;
  count: number;
  now: Date;
}): string[] {
  return input.coins
    .filter((coin) => !input.exclude.has(coin.mint))
    .sort((left, right) => drawKey(left.mint, input.now) - drawKey(right.mint, input.now))
    .slice(0, Math.max(0, input.count))
    .map((coin) => coin.mint);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 95% interval for the mean paired difference. Whole days are redrawn together,
 * and a matched pair is never split across resamples.
 */
export function blockBootstrapDelta(input: {
  pairs: readonly { day: string; wallet: number; control: number }[];
  replicates?: number;
  seed?: number;
  blockDays?: number;
}): { mean: number | null; low: number | null; high: number | null } {
  const days = [...new Set(input.pairs.map((pair) => pair.day))].sort();
  const byDay = new Map<string, Array<{ wallet: number; control: number }>>();
  for (const pair of input.pairs) {
    const list = byDay.get(pair.day) ?? [];
    list.push(pair);
    byDay.set(pair.day, list);
  }
  const width = Math.max(1, input.blockDays ?? 1);
  const blocks: string[][] = [];
  for (let index = 0; index < days.length; index += width)
    blocks.push(days.slice(index, index + width));
  const meanOf = (chosen: readonly string[]) => {
    const rows = chosen.flatMap((day) => byDay.get(day) ?? []);
    if (rows.length === 0) return null;
    return rows.reduce((sum, row) => sum + (row.wallet - row.control), 0) / rows.length;
  };
  const observed = meanOf(days);
  if (blocks.length === 0 || observed === null) return { mean: null, low: null, high: null };
  const random = mulberry32(input.seed ?? 1);
  const replicates = input.replicates ?? 200;
  const draws: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate += 1) {
    const chosen: string[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[Math.floor(random() * blocks.length)] ?? [];
      chosen.push(...block);
    }
    const value = meanOf(chosen);
    if (value !== null) draws.push(value);
  }
  draws.sort((left, right) => left - right);
  const at = (quantile: number) =>
    draws[Math.min(draws.length - 1, Math.max(0, Math.floor(quantile * (draws.length - 1))))] ??
    null;
  return { mean: observed, low: at(0.025), high: at(0.975) };
}

export function experimentCall(input: {
  deltaLow: number | null;
  deltaHigh: number | null;
  walletMean: number | null;
  walletHigh: number | null;
  requiredReturn: number;
  gatesPass: boolean;
  survivesSensitivity: boolean;
  economicsFail: boolean;
}): "go" | "no_go" | "inconclusive" {
  if (input.economicsFail) return "no_go";
  if (input.deltaHigh !== null && input.deltaHigh < EXPERIMENT_MIN_ADVANTAGE) return "no_go";
  if (input.walletHigh !== null && input.walletHigh < input.requiredReturn) return "no_go";
  if (
    input.deltaLow !== null &&
    input.deltaLow > EXPERIMENT_MIN_ADVANTAGE &&
    input.walletMean !== null &&
    input.walletMean > input.requiredReturn &&
    input.gatesPass &&
    input.survivesSensitivity
  ) {
    return "go";
  }
  return "inconclusive";
}
