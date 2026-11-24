/** Frozen for this release. The address list is loaded once and not rotated. */
export const DIAGNOSTIC_WALLET_LIST_VERSION = "diagnostic-cohort-2026-11-24";

export const DIAGNOSTIC_INCREMENTAL_CEILING_USD = 25;

export const DIAGNOSTIC_BUDGET = {
  maxHeliusCredits: 50_000,
  maxJupiterQuotesPerDay: 2_000,
  maxPublicRpcCallsPerDay: 20_000,
  jupiterQuotesPerMinute: 24,
  incrementalCeilingUsd: DIAGNOSTIC_INCREMENTAL_CEILING_USD,
} as const;

export const CANDIDATE_VENUES = [
  {
    id: "pump",
    sourceProgram: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
    graduationRule: "pump_migrate into the PumpSwap program",
    destinationProgram: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
    destinationPool: "pumpswap",
  },
  {
    id: "launchlab",
    sourceProgram: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
    graduationRule: "launchlab_migrate",
    destinationProgram: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
    destinationPool: "launchlab_graduated_pool",
  },
  {
    id: "meteora",
    sourceProgram: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
    graduationRule: "dbc_migration_damm_v2",
    destinationProgram: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
    destinationPool: "damm_v2",
  },
] as const;

export const MIN_REFERENCE_EVENTS = 300;
export const MIN_WALLET_SWAPS = 300;
export const RECALL_LOWER_LIMIT = 0.99;

export interface VenueCounts {
  id: string;
  graduationEvents: number;
  referenceEventsByClass: Readonly<Record<string, number>>;
  walletBuys: number;
  walletSells: number;
  scansComplete: boolean;
  recallSuccesses: number;
  recallTrials: number;
}

export function exactBinomialLower(successes: number, trials: number, alpha = 0.05): number {
  if (!Number.isInteger(trials) || !Number.isInteger(successes)) {
    throw new Error("binomial counts must be integers");
  }
  if (trials <= 0 || successes < 0 || successes > trials) throw new Error("invalid binomial");
  if (successes === 0) return 0;
  if (successes === trials) return Math.exp(Math.log(alpha) / trials);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (low + high) / 2;
    if (binomialUpperTail(successes, trials, mid) > alpha) low = mid;
    else high = mid;
  }
  return low;
}

function binomialUpperTail(successes: number, trials: number, probability: number): number {
  let sum = 0;
  for (let count = successes; count <= trials; count += 1) {
    const log =
      logChoose(trials, count) +
      count * Math.log(probability) +
      (trials - count) * Math.log(1 - probability);
    sum += Math.exp(log);
  }
  return sum;
}

function logChoose(trials: number, count: number): number {
  let total = 0;
  for (let index = 1; index <= count; index += 1) {
    total += Math.log(trials - count + index) - Math.log(index);
  }
  return total;
}

export function diagnosticWindow(start: Date): {
  warmupHours: 24;
  diagnosticDays: 7;
  warmupEnd: Date;
  end: Date;
  extension: "none";
} {
  const warmupEnd = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return {
    warmupHours: 24,
    diagnosticDays: 7,
    warmupEnd,
    end: new Date(warmupEnd.getTime() + 7 * 24 * 60 * 60 * 1000),
    extension: "none",
  };
}

export function diagnosticBudgetStop(input: {
  heliusCredits: number;
  jupiterQuotesToday: number;
  publicRpcCallsToday: number;
}): { stop: boolean; reason: "helius" | "jupiter" | "public_rpc" | null } {
  if (input.heliusCredits > DIAGNOSTIC_BUDGET.maxHeliusCredits) {
    return { stop: true, reason: "helius" };
  }
  if (input.jupiterQuotesToday > DIAGNOSTIC_BUDGET.maxJupiterQuotesPerDay) {
    return { stop: true, reason: "jupiter" };
  }
  if (input.publicRpcCallsToday > DIAGNOSTIC_BUDGET.maxPublicRpcCallsPerDay) {
    return { stop: true, reason: "public_rpc" };
  }
  return { stop: false, reason: null };
}

export function venuePasses(counts: VenueCounts): boolean {
  const classes = Object.values(counts.referenceEventsByClass);
  if (classes.length === 0 || classes.some((value) => value < MIN_REFERENCE_EVENTS)) return false;
  if (counts.graduationEvents < MIN_REFERENCE_EVENTS) return false;
  if (counts.walletBuys < MIN_WALLET_SWAPS || counts.walletSells < MIN_WALLET_SWAPS) return false;
  if (!counts.scansComplete) return false;
  return exactBinomialLower(counts.recallSuccesses, counts.recallTrials) >= RECALL_LOWER_LIMIT;
}

export function selectDiagnosticVenue(input: {
  now: Date;
  end: Date;
  earlyStop: "none" | "integrity" | "budget";
  venues: readonly VenueCounts[];
}): { status: "wait" | "selected" | "insufficient_evidence"; venue: string | null } {
  if (input.earlyStop !== "none") return { status: "insufficient_evidence", venue: null };
  if (input.now.getTime() < input.end.getTime()) return { status: "wait", venue: null };
  const passers = input.venues.filter(venuePasses);
  if (passers.length === 0) return { status: "insufficient_evidence", venue: null };
  const ranked = [...passers].sort((left, right) => {
    const leftDenom = left.recallTrials;
    const rightDenom = right.recallTrials;
    return rightDenom - leftDenom;
  });
  const best = ranked[0];
  const second = ranked[1];
  if (!best) return { status: "insufficient_evidence", venue: null };
  if (second && second.recallTrials === best.recallTrials) {
    return { status: "insufficient_evidence", venue: null };
  }
  return { status: "selected", venue: best.id };
}
