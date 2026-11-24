import { EXPERIMENT_MIN_ADVANTAGE, experimentCall } from "./experimentProtocol.js";

export const EXPERIMENT_MATCH_SEED = "experiment-v2-match-seed";
export const MIN_BUY_SOL = 0.002;
export const EXCLUDED_PROTOCOL_PREFIX = "c1d34366";
export const VOIDED_POSITIONS = 79;
export const ENTRY_LATENESS_MS = 3 * 60 * 1000;

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
  const dispatch = pairs
    .flatMap((pair) => [pair.wallet, pair.control])
    .sort(
      (left, right) =>
        drawKey(left, input.wallets[0]?.decisionAt ?? "", seed) -
        drawKey(right, input.wallets[0]?.decisionAt ?? "", seed),
    );
  return { pairs, unmatched, dispatch };
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

export function acceptEntryObservation(input: {
  entryAt: Date;
  observedAt: Date;
  valid: boolean;
}): {
  usable: boolean;
  late: boolean;
} {
  const late = input.observedAt.getTime() - input.entryAt.getTime() > ENTRY_LATENESS_MS;
  return { usable: input.valid && !late, late };
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

export function simulateEqualBankrolls(input: {
  wallet: readonly (number | null)[];
  control: readonly (number | null)[];
  bankroll: number;
  notional: number;
  maxConcurrent: number;
}): { walletCash: number; controlCash: number; reserved: number; skipped: number } {
  const step = (returns: readonly (number | null)[]) => {
    let cash = input.bankroll;
    let open = 0;
    let reserved = 0;
    let skipped = 0;
    for (const value of returns) {
      if (open >= input.maxConcurrent || cash < input.notional) {
        skipped += 1;
        continue;
      }
      if (value === null) {
        reserved += input.notional;
        cash -= input.notional;
        open += 1;
        continue;
      }
      cash -= input.notional;
      cash += input.notional * (1 + value);
    }
    return { cash, reserved, skipped };
  };
  const wallet = step(input.wallet);
  const control = step(input.control);
  return {
    walletCash: wallet.cash,
    controlCash: control.cash,
    reserved: wallet.reserved + control.reserved,
    skipped: wallet.skipped + control.skipped,
  };
}

export function pooledPairMean(pairs: readonly { day: string; diff: number }[]): number | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((sum, pair) => sum + pair.diff, 0) / pairs.length;
}

export function qualificationGate(input: {
  ciGreenOnCommit: boolean;
  isolationTested: boolean;
  walletClassificationTested: boolean;
  matchingImmutable: boolean;
  horizonRecordsHonest: boolean;
  venueRecallScheduled: boolean;
  configChangedDuringShadow: boolean;
}): { countDays: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.ciGreenOnCommit) reasons.push("ci");
  if (!input.isolationTested) reasons.push("isolation");
  if (!input.walletClassificationTested) reasons.push("wallet_classification");
  if (!input.matchingImmutable) reasons.push("matching");
  if (!input.horizonRecordsHonest) reasons.push("horizons");
  if (!input.venueRecallScheduled) reasons.push("venue_recall");
  if (input.configChangedDuringShadow) reasons.push("config_changed");
  return { countDays: reasons.length === 0, reasons };
}
