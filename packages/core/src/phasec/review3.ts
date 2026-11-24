import {
  EXPERIMENT_ENTRY_DELAY_MS,
  EXPERIMENT_MIN_ADVANTAGE,
  experimentCall,
} from "./experimentProtocol.js";

export const EXPERIMENT_MATCH_SEED = "experiment-v2-match-seed";
export const MIN_BUY_SOL = 0.002;
export const EXCLUDED_PROTOCOL_PREFIX = "c1d34366";
export const VOIDED_POSITIONS = 79;
/** Frozen entry lateness. A quote later than this after the due time is not a fill. */
export const ENTRY_LATENESS_S = 60;
export const ENTRY_LATENESS_MS = ENTRY_LATENESS_S * 1000;
/** Scored inference stays off until a calibration is accepted. Shadow collection is unaffected. */
export const INFERENTIAL_GO_ENABLED = false;

export interface EnrollmentPair {
  wallet: number | null;
  control: number | null;
  /** Unfilled is a known 0. Unresolved is null and is not a measured 0. */
  walletUnfilled?: boolean;
  controlUnfilled?: boolean;
}

/**
 * Counts stay separate. The known sum is not divided by the full enrollment,
 * because that would pretend a missing exit was a zero. The complete-case mean
 * is a diagnostic. The full-population mean is not identifiable without an
 * assumption about the missing rows.
 */
export function enrollmentEstimate(pairs: readonly EnrollmentPair[]): {
  enrolled: number;
  known: number;
  unresolved: number;
  unfilled: number;
  completeCaseMean: number | null;
  fullPopulation: "not_identifiable";
} {
  let known = 0;
  let unresolved = 0;
  let unfilled = 0;
  let sum = 0;
  for (const pair of pairs) {
    const walletKnown = pair.wallet !== null || pair.walletUnfilled === true;
    const controlKnown = pair.control !== null || pair.controlUnfilled === true;
    if (pair.walletUnfilled || pair.controlUnfilled) unfilled += 1;
    if (!walletKnown || !controlKnown) {
      unresolved += 1;
      continue;
    }
    known += 1;
    sum += (pair.wallet ?? 0) - (pair.control ?? 0);
  }
  return {
    enrolled: pairs.length,
    known,
    unresolved,
    unfilled,
    completeCaseMean: known === 0 ? null : sum / known,
    fullPopulation: "not_identifiable",
  };
}

/**
 * The example the review named. 0.095/2 is a labeled sensitivity, not the primary mean.
 * Unfilled zeros stay in the complete-pair diagnostic. Filled-only is a different set.
 */
export function labeledPairMeans(pairs: readonly EnrollmentPair[]): {
  enrolled: number;
  resolved: number;
  unresolved: number;
  fullPopulationMean: "UNKNOWN";
  completePairMean: number | null;
  filledOnlyMean: number | null;
  zeroImputationMean: number | null;
} {
  const estimate = enrollmentEstimate(pairs);
  const filled = pairs.filter(
    (pair) =>
      pair.wallet !== null &&
      pair.control !== null &&
      pair.walletUnfilled !== true &&
      pair.controlUnfilled !== true,
  );
  const filledSum = filled.reduce((sum, pair) => sum + (pair.wallet ?? 0) - (pair.control ?? 0), 0);
  return {
    enrolled: estimate.enrolled,
    resolved: estimate.known,
    unresolved: estimate.unresolved,
    fullPopulationMean: "UNKNOWN",
    completePairMean: estimate.completeCaseMean,
    filledOnlyMean: filled.length === 0 ? null : filledSum / filled.length,
    zeroImputationMean:
      estimate.enrolled === 0 || estimate.completeCaseMean === null
        ? null
        : (estimate.completeCaseMean * estimate.known) / estimate.enrolled,
  };
}

export type MissingAssumption = "wallet_lost" | "control_gained";

/** Hostile assumptions differ by which side is missing. They are not the primary mean. */
export function applyMissingAssumption(
  pairs: readonly EnrollmentPair[],
  assumption: MissingAssumption,
): number | null {
  const filled = pairs.map((pair) => {
    const wallet =
      pair.wallet !== null
        ? pair.wallet
        : pair.walletUnfilled
          ? 0
          : assumption === "wallet_lost"
            ? -1
            : null;
    const control =
      pair.control !== null
        ? pair.control
        : pair.controlUnfilled
          ? 0
          : assumption === "control_gained"
            ? 1
            : null;
    if (wallet === null || control === null) return null;
    return wallet - control;
  });
  const known = filled.filter((value): value is number => value !== null);
  if (known.length !== pairs.length || known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0) / known.length;
}

/**
 * Inconclusive when a missing-data assumption would change the call at +5pp
 * or at the overhead hurdle, or when the bounds are not credible.
 */
export function missingnessChangesDecision(input: {
  completeLow: number | null;
  completeHigh: number | null;
  walletMean: number | null;
  requiredReturn: number;
  assumedMeans: readonly (number | null)[];
  gatesPass: boolean;
}): { identifiable: boolean; inconclusive: boolean; calls: string[] } {
  const base: string = experimentCall({
    deltaLow: input.completeLow,
    deltaHigh: input.completeHigh,
    walletMean: input.walletMean,
    walletHigh: input.walletMean,
    requiredReturn: input.requiredReturn,
    gatesPass: input.gatesPass,
    survivesSensitivity: true,
    economicsFail: false,
  });
  const calls = [base];
  for (const mean of input.assumedMeans) {
    if (mean === null) {
      calls.push("not_identifiable");
      continue;
    }
    const above = mean > EXPERIMENT_MIN_ADVANTAGE;
    const profitable = (input.walletMean ?? -1) > input.requiredReturn;
    calls.push(
      above && profitable && input.gatesPass
        ? "go"
        : mean < EXPERIMENT_MIN_ADVANTAGE
          ? "no_go"
          : "inconclusive",
    );
  }
  const distinct = new Set(calls);
  return {
    identifiable: input.assumedMeans.every((mean) => mean !== null) && input.completeLow !== null,
    inconclusive: distinct.size > 1 || calls.includes("not_identifiable"),
    calls,
  };
}

export function drawKey(mint: string, decisionAt: string, seed: string): number {
  const text = `${seed}:${decisionAt}:${mint}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface MatchCoin {
  mint: string;
  venue: string;
  liquidityUsd: number | null;
  minutesSinceGraduation: number;
  hourUtc: number;
  decisionAt: string;
}

export type MatchTier = "exact" | "age_adjacent" | "liquidity_wider" | "unmatched";

const AGE_BANDS = ["0_10", "10_20", "20_30"] as const;
const LIQ_BANDS = ["under_15k", "15k_50k", "50k_plus"] as const;

export function ageBandOf(minutes: number): (typeof AGE_BANDS)[number] | null {
  if (minutes < 0 || minutes > 30) return null;
  if (minutes < 10) return "0_10";
  if (minutes < 20) return "10_20";
  return "20_30";
}

export function liquidityBandOf(usd: number | null): (typeof LIQ_BANDS)[number] | "unknown" {
  if (usd === null || !Number.isFinite(usd)) return "unknown";
  if (usd < 15_000) return "under_15k";
  if (usd < 50_000) return "15k_50k";
  return "50k_plus";
}

function adjacent(list: readonly string[], left: string, right: string): boolean {
  const a = list.indexOf(left);
  const b = list.indexOf(right);
  return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
}

export function matchTier(
  wallet: MatchCoin,
  control: MatchCoin,
  allowlist: readonly string[],
): MatchTier {
  if (!allowlist.includes(wallet.venue) || control.venue !== wallet.venue) return "unmatched";
  if (control.decisionAt !== wallet.decisionAt) return "unmatched";
  if (control.hourUtc !== wallet.hourUtc) return "unmatched";
  const walletAge = ageBandOf(wallet.minutesSinceGraduation);
  const controlAge = ageBandOf(control.minutesSinceGraduation);
  if (!walletAge || !controlAge) return "unmatched";
  const ageGap = Math.abs(wallet.minutesSinceGraduation - control.minutesSinceGraduation);
  const walletLiq = liquidityBandOf(wallet.liquidityUsd);
  const controlLiq = liquidityBandOf(control.liquidityUsd);
  if (walletLiq === "unknown" || controlLiq === "unknown") return "unmatched";
  const sameAge = walletAge === controlAge;
  const sameLiq = walletLiq === controlLiq;
  if (sameAge && sameLiq) return "exact";
  if (sameLiq && adjacent(AGE_BANDS, walletAge, controlAge) && ageGap <= 10) return "age_adjacent";
  if (
    (sameAge || (adjacent(AGE_BANDS, walletAge, controlAge) && ageGap <= 10)) &&
    adjacent(LIQ_BANDS, walletLiq, controlLiq)
  ) {
    return "liquidity_wider";
  }
  return "unmatched";
}

const TIER_ORDER: MatchTier[] = ["exact", "age_adjacent", "liquidity_wider"];

export function matchContemporaneous(input: {
  wallets: readonly MatchCoin[];
  screened: readonly MatchCoin[];
  allowlist: readonly string[];
  reserved?: ReadonlySet<string>;
  seed?: string;
}): {
  pairs: Array<{ wallet: string; control: string; tier: MatchTier; liquidityGap: number | null }>;
  unmatched: Array<{ wallet: string; reason: string }>;
  dispatch: string[];
  balance: { byTier: Record<string, number>; meanAbsLiquidityGap: number | null };
} {
  const used = new Set(input.reserved ?? []);
  const seed = input.seed ?? EXPERIMENT_MATCH_SEED;
  const pairs: Array<{
    wallet: string;
    control: string;
    tier: MatchTier;
    liquidityGap: number | null;
  }> = [];
  const unmatched: Array<{ wallet: string; reason: string }> = [];
  for (const wallet of input.wallets) {
    if (!input.allowlist.includes(wallet.venue)) {
      unmatched.push({ wallet: wallet.mint, reason: "venue_not_validated" });
      continue;
    }
    if (ageBandOf(wallet.minutesSinceGraduation) === null) {
      unmatched.push({ wallet: wallet.mint, reason: "outside_graduation_window" });
      continue;
    }
    let chosen: { coin: MatchCoin; tier: MatchTier } | null = null;
    for (const tier of TIER_ORDER) {
      const pool = input.screened
        .filter((coin) => !used.has(coin.mint) && matchTier(wallet, coin, input.allowlist) === tier)
        .sort(
          (left, right) =>
            drawKey(left.mint, wallet.decisionAt, seed) -
            drawKey(right.mint, wallet.decisionAt, seed),
        );
      const first = pool[0];
      if (first) {
        chosen = { coin: first, tier };
        break;
      }
    }
    if (!chosen) {
      unmatched.push({ wallet: wallet.mint, reason: "stratum_empty" });
      continue;
    }
    used.add(chosen.coin.mint);
    const liquidityGap =
      wallet.liquidityUsd === null || chosen.coin.liquidityUsd === null
        ? null
        : Math.abs(wallet.liquidityUsd - chosen.coin.liquidityUsd);
    pairs.push({
      wallet: wallet.mint,
      control: chosen.coin.mint,
      tier: chosen.tier,
      liquidityGap,
    });
  }
  const decisionAt = input.wallets[0]?.decisionAt ?? "";
  const dispatch = pairs
    .flatMap((pair) => [pair.wallet, pair.control])
    .sort((left, right) => drawKey(left, decisionAt, seed) - drawKey(right, decisionAt, seed));
  return { pairs, unmatched, dispatch, balance: matchBalance(pairs) };
}

export function matchBalance(pairs: readonly { tier: MatchTier; liquidityGap: number | null }[]): {
  byTier: Record<string, number>;
  meanAbsLiquidityGap: number | null;
} {
  const byTier: Record<string, number> = {};
  const gaps: number[] = [];
  for (const pair of pairs) {
    byTier[pair.tier] = (byTier[pair.tier] ?? 0) + 1;
    if (pair.liquidityGap !== null) gaps.push(pair.liquidityGap);
  }
  return {
    byTier,
    meanAbsLiquidityGap:
      gaps.length === 0 ? null : gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length,
  };
}

/** Pre-screen universe. An already enrolled mint is not reused. */
export function matchBenchmark(input: {
  wallets: readonly MatchCoin[];
  universe: readonly MatchCoin[];
  enrolled: ReadonlySet<string>;
  allowlist: readonly string[];
  seed?: string;
}): { pairs: Array<{ wallet: string; benchmark: string; tier: MatchTier }>; unmatched: string[] } {
  const matched = matchContemporaneous({
    wallets: input.wallets,
    screened: input.universe.filter((coin) => !input.enrolled.has(coin.mint)),
    allowlist: input.allowlist,
    reserved: input.enrolled,
    seed: input.seed,
  });
  return {
    pairs: matched.pairs.map((pair) => ({
      wallet: pair.wallet,
      benchmark: pair.control,
      tier: pair.tier,
    })),
    unmatched: matched.unmatched.map((row) => row.wallet),
  };
}

export interface FillClass {
  role: "coin_buy" | "coin_sell" | "payment_leg" | "sol_only" | "rent_sized_buy" | "unclassified";
  countsInNet: boolean;
  qualifyingBuy: boolean;
}

/** 0.002 SOL is the strategy's minimum buy, not a law of the chain. It does not hide a sell. */
export function classifyFill(input: {
  mint: string;
  wrappedSolMint: string;
  side: "buy" | "sell" | "swap" | "unknown";
  solAmount: number | null;
  tokenAmount: number | null;
}): FillClass {
  if (input.mint === input.wrappedSolMint) {
    return { role: "payment_leg", countsInNet: false, qualifyingBuy: false };
  }
  if (input.tokenAmount === null && input.solAmount !== null) {
    return { role: "sol_only", countsInNet: false, qualifyingBuy: false };
  }
  if (input.tokenAmount === null || input.side === "unknown") {
    return { role: "unclassified", countsInNet: false, qualifyingBuy: false };
  }
  if (input.side === "sell" || (input.tokenAmount < 0 && input.side !== "buy")) {
    return { role: "coin_sell", countsInNet: true, qualifyingBuy: false };
  }
  if (input.solAmount === null || Math.abs(input.solAmount) < MIN_BUY_SOL) {
    return { role: "rent_sized_buy", countsInNet: false, qualifyingBuy: false };
  }
  return { role: "coin_buy", countsInNet: true, qualifyingBuy: true };
}

export function accumulation(input: {
  fills: readonly FillClass[];
  venuesObserved: readonly string[];
  venuesRequired: readonly string[];
}): { status: "net_buyer" | "flat_or_sold" | "unknown"; confidence: "full" | "reduced" } {
  if (input.fills.some((fill) => fill.role === "unclassified" || fill.role === "sol_only")) {
    return { status: "unknown", confidence: "reduced" };
  }
  const missingVenue = input.venuesRequired.some((venue) => !input.venuesObserved.includes(venue));
  const buys = input.fills.filter((fill) => fill.qualifyingBuy).length;
  const sells = input.fills.filter((fill) => fill.role === "coin_sell").length;
  return {
    status: buys > sells ? "net_buyer" : "flat_or_sold",
    confidence: missingVenue ? "reduced" : "full",
  };
}

export function recallWalletSwaps(input: {
  known: ReadonlySet<string>;
  reference: readonly string[];
}): { checked: number; missing: string[] } {
  return {
    checked: input.reference.length,
    missing: input.reference.filter((signature) => !input.known.has(signature)),
  };
}

export interface EffectiveConfig {
  mode: "shadow" | "scored";
  draft: boolean;
  commit: string | null;
  venueAllowlist: readonly string[];
  notionalUsd: number;
  scaleOut: boolean;
  stops: boolean;
  walletListVersion: string | null;
}

export function validateExperimentConfig(input: EffectiveConfig): {
  ok: boolean;
  reason: string | null;
} {
  if (input.scaleOut) return { ok: false, reason: "scale_out_refused" };
  if (input.stops) return { ok: false, reason: "stop_refused" };
  if (input.notionalUsd !== 20) return { ok: false, reason: "notional_not_20" };
  if (input.mode === "scored") {
    if (input.draft) return { ok: false, reason: "scored_requires_frozen_config" };
    if (!input.commit) return { ok: false, reason: "scored_requires_commit" };
    if (input.venueAllowlist.length === 0) return { ok: false, reason: "scored_requires_venue" };
    if (!input.walletListVersion) return { ok: false, reason: "scored_requires_wallet_list" };
  }
  return { ok: true, reason: null };
}

export function poolCanHoldNotional(
  liquidityUsd: number | null,
  notionalUsd: number,
  share = 0.01,
): boolean {
  if (liquidityUsd === null || !(liquidityUsd > 0)) return false;
  return liquidityUsd * share + 1e-9 >= notionalUsd;
}

export function entryDeadline(decisionAt: Date): { entryDueAt: Date; latestEntryAt: Date } {
  const entryDueAt = new Date(decisionAt.getTime() + EXPERIMENT_ENTRY_DELAY_MS);
  return {
    entryDueAt,
    latestEntryAt: new Date(entryDueAt.getTime() + ENTRY_LATENESS_MS),
  };
}

/** The exit clock starts at the hypothetical fill, not at the decision. */
export function exitDeadline(fillAt: Date): Date {
  return new Date(fillAt.getTime() + 60 * 60 * 1000);
}

export function acceptEntryObservation(input: {
  entryDueAt: Date;
  observedAt: Date;
  valid: boolean;
}): {
  usable: boolean;
  late: boolean;
} {
  const latest = input.entryDueAt.getTime() + ENTRY_LATENESS_MS;
  const late = input.observedAt.getTime() > latest;
  const early = input.observedAt.getTime() < input.entryDueAt.getTime();
  return { usable: input.valid && !late && !early, late };
}

export function chooseFirstValidExit<T extends { at: Date; valid: boolean; price: number }>(
  attempts: readonly T[],
  deadline: Date,
  latenessMs: number,
): T | null {
  const windowEnd = deadline.getTime() + latenessMs;
  const usable = attempts
    .filter(
      (attempt) =>
        attempt.valid &&
        attempt.at.getTime() >= deadline.getTime() &&
        attempt.at.getTime() <= windowEnd,
    )
    .sort((left, right) => left.at.getTime() - right.at.getTime());
  return usable[0] ?? null;
}

export function enrollmentId(mint: string, enrolledAt: Date): string {
  return drawKey(mint, enrolledAt.toISOString(), "enrollment").toString(16);
}

export function isExcludedProtocol(fingerprint: string): boolean {
  return fingerprint.startsWith(EXCLUDED_PROTOCOL_PREFIX);
}

export interface ScenarioFill {
  pairId: string;
  observedRoute: "unknown";
  assumedSchedule: "solana_other" | "solana_lowest_fee";
  tokenCashUsd: number;
  filled: boolean;
}

/** Pairs are frozen first. Fee scenarios do not rematch. */
export function scenarioFills(input: {
  pairIds: readonly string[];
  schedule: "solana_other" | "solana_lowest_fee";
  tokenCashUsd: number;
  entryImpactPct: number | null;
  capPct: number;
}): ScenarioFill[] {
  return input.pairIds.map((pairId) => ({
    pairId,
    observedRoute: "unknown",
    assumedSchedule: input.schedule,
    tokenCashUsd: input.tokenCashUsd,
    filled: input.entryImpactPct !== null && input.entryImpactPct <= input.capPct,
  }));
}

/**
 * An unresolved fill is not equity. The $20 is unavailable for a new entry.
 * Recoverable value and opportunity return stay unknown. Loss-pause does not
 * treat that unknown as a realized loss. This does not admit or reject a shadow enrollment.
 */
export function valueUnresolvedFill(input: {
  bankroll: number;
  notional: number;
  tokenQty: number;
}): {
  spendableCash: number;
  capitalUnavailable: number;
  tokenQty: number;
  recoverableValue: "unknown";
  equity: "unknown";
  zeroRecoveryStressEquity: number;
  opportunityReturn: "unknown";
  admitsFromSpendableCashOnly: true;
  lossPauseIgnoresUnresolved: true;
  controlsShadowEnrollment: false;
} {
  return {
    spendableCash: input.bankroll - input.notional,
    capitalUnavailable: input.notional,
    tokenQty: input.tokenQty,
    recoverableValue: "unknown",
    equity: "unknown",
    zeroRecoveryStressEquity: input.bankroll - input.notional,
    opportunityReturn: "unknown",
    admitsFromSpendableCashOnly: true,
    lossPauseIgnoresUnresolved: true,
    controlsShadowEnrollment: false,
  };
}

export function simulateEqualBankrolls(input: {
  wallet: readonly (number | null)[];
  control: readonly (number | null)[];
  bankroll: number;
  notional: number;
  maxConcurrent: number;
}): {
  spendableCash: number;
  capitalUnavailable: number;
  skipped: number;
  equity: "unknown" | number;
} {
  const step = (returns: readonly (number | null)[]) => {
    let spendable = input.bankroll;
    let open = 0;
    let unavailable = 0;
    let skipped = 0;
    let unresolved = false;
    for (const value of returns) {
      if (open >= input.maxConcurrent || spendable < input.notional) {
        skipped += 1;
        continue;
      }
      if (value === null) {
        spendable -= input.notional;
        unavailable += input.notional;
        open += 1;
        unresolved = true;
        continue;
      }
      spendable -= input.notional;
      spendable += input.notional * (1 + value);
    }
    return { spendable, unavailable, skipped, unresolved };
  };
  const wallet = step(input.wallet);
  const control = step(input.control);
  const unresolved = wallet.unresolved || control.unresolved;
  return {
    spendableCash: wallet.spendable,
    capitalUnavailable: wallet.unavailable + control.unavailable,
    skipped: wallet.skipped + control.skipped,
    equity: unresolved ? "unknown" : wallet.spendable,
  };
}

export function pooledPairMean(pairs: readonly { day: string; diff: number }[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, pair) => sum + pair.diff, 0) / pairs.length;
}

function unitRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalDraw(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = Math.max(1e-12, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Cluster-robust interval for a complete-data mean. The target is the
 * generating effect. This is not a substitute for the full-population mean,
 * which stays UNKNOWN when any pair is unresolved.
 */
export function clusterRobustInterval(diffsByDay: readonly (readonly number[])[]): {
  mean: number | null;
  low: number | null;
  high: number | null;
} {
  const days = diffsByDay.filter((day) => day.length > 0);
  const flat = days.flat();
  if (flat.length === 0 || days.length < 2) return { mean: null, low: null, high: null };
  const mean = flat.reduce((sum, value) => sum + value, 0) / flat.length;
  let score2 = 0;
  for (const day of days) {
    const score = day.reduce((sum, value) => sum + (value - mean), 0);
    score2 += score * score;
  }
  const g = days.length;
  const se = Math.sqrt((g / (g - 1)) * score2) / flat.length;
  const t = g - 1 >= 7 ? 2.364624 : 2.570582;
  return { mean, low: mean - t * se, high: mean + t * se };
}

export interface CalibrationScenario {
  name: string;
  sims: number;
  estimand: string;
  rate: number;
  low: number;
  high: number;
  inferentialGoEnabled: false;
}

/**
 * Predeclared scenarios. 2,000 draws each. Coverage and power are reported
 * only for the complete-data cluster interval. A sample with missing exits
 * has an UNKNOWN primary mean, so that scenario reports the inconclusive rate
 * and does not report coverage of an imputed mean.
 */
function wilsonInterval(successes: number, sims: number): { low: number; high: number } {
  const z = 1.959963984540054;
  const p = successes / sims;
  const z2 = z * z;
  const denom = 1 + z2 / sims;
  const center = (p + z2 / (2 * sims)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / sims + z2 / (4 * sims * sims))) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

function clusteredSample(random: () => number, trueDelta: number, missingRate: number): number[][] {
  const days: number[][] = [];
  for (let day = 0; day < 8; day += 1) {
    const shock = random() < 0.05 ? 1.5 : 0;
    const row: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      if (random() < missingRate) continue;
      row.push(trueDelta + shock + normalDraw(random) * 0.25);
    }
    days.push(row);
  }
  return days;
}

export function measureBootstrapCalibration(seed = 11): {
  inferentialGoEnabled: false;
  scenarios: CalibrationScenario[];
} {
  const sims = 2000;
  const random = unitRandom(seed);
  const run = (
    name: string,
    estimand: string,
    trueDelta: number,
    missingRate: number,
    score: (interval: { low: number | null; high: number | null }, unresolved: boolean) => boolean,
  ): CalibrationScenario => {
    let hits = 0;
    for (let sim = 0; sim < sims; sim += 1) {
      const days = clusteredSample(random, trueDelta, missingRate);
      const unresolved = days.some((day) => day.length < 8);
      const interval = unresolved ? { low: null, high: null } : clusterRobustInterval(days);
      if (score(interval, unresolved)) hits += 1;
    }
    const band = wilsonInterval(hits, sims);
    return {
      name,
      sims,
      estimand,
      rate: hits / sims,
      low: band.low,
      high: band.high,
      inferentialGoEnabled: false,
    };
  };
  return {
    inferentialGoEnabled: false,
    scenarios: [
      run(
        "complete_coverage_at_0",
        "generating effect 0, complete pairs, cluster interval",
        0,
        0,
        (interval) =>
          interval.low !== null &&
          interval.high !== null &&
          interval.low <= 0 &&
          interval.high >= 0,
      ),
      run(
        "complete_false_go_at_5pp_boundary",
        "generating effect +5pp, false claim that the lower bound exceeds +5pp",
        0.05,
        0,
        (interval) => interval.low !== null && interval.low > EXPERIMENT_MIN_ADVANTAGE,
      ),
      run(
        "complete_power_at_15pp",
        "generating effect +15pp, lower bound above +5pp on complete data only",
        0.15,
        0,
        (interval) => interval.low !== null && interval.low > EXPERIMENT_MIN_ADVANTAGE,
      ),
      run(
        "missing_primary_inconclusive",
        "any unresolved pair makes the primary mean UNKNOWN, so the call is inconclusive",
        0.15,
        0.15,
        (_interval, unresolved) => unresolved,
      ),
    ],
  };
}

export const REQUIRED_MIGRATIONS = [
  "023_scale_booking",
  "024_quote_failure",
  "025_wallet_fill_amounts",
  "026_candidate_log",
  "027_execution_record",
  "028_wide_recovery",
  "029_review3_records",
  "030_observation_claim",
  "031_run_identity",
] as const;

export function qualificationRunId(input: {
  commit: string | null;
  walletListVersion: string | null;
  venueAllowlist: readonly string[];
}): string | null {
  if (!input.commit || !input.walletListVersion || input.venueAllowlist.length === 0) return null;
  return drawKey(input.commit, input.walletListVersion, input.venueAllowlist.join(",")).toString(
    16,
  );
}

export function qualificationGate(input: {
  ciGreenOnCommit: boolean;
  isolationTested: boolean;
  walletClassificationTested: boolean;
  matchingImmutable: boolean;
  horizonRecordsHonest: boolean;
  venueRecallScheduled: boolean;
  configChangedDuringShadow: boolean;
  venueScopeSet: boolean;
  walletListVersionSet: boolean;
}): { countDays: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.ciGreenOnCommit) reasons.push("ci");
  if (!input.isolationTested) reasons.push("isolation");
  if (!input.walletClassificationTested) reasons.push("wallet_classification");
  if (!input.matchingImmutable) reasons.push("matching");
  if (!input.horizonRecordsHonest) reasons.push("horizons");
  if (!input.venueRecallScheduled) reasons.push("venue_recall");
  if (input.configChangedDuringShadow) reasons.push("config_changed");
  if (!input.venueScopeSet) reasons.push("venue_scope_unset");
  if (!input.walletListVersionSet) reasons.push("wallet_list_unset");
  return { countDays: reasons.length === 0, reasons };
}
