import {
  DIAGNOSTIC_DELAYS_MS,
  EXPERIMENT_HORIZON_MS,
  EXPERIMENT_LATENESS_MS,
  enrollmentTimeline,
  executionRecord,
  type StratumCoin,
} from "./experimentProtocol.js";
import { matchBenchmark, matchContemporaneous, type MatchCoin } from "./review3.js";
import { isFlapMint, stageForCoin, type ScoreCoin } from "./score.js";
import { screenCoin, type ScreenFacts, type ScreenRules } from "./screen.js";
import type { Stage } from "./protocol.js";
import type { PlannedEntry } from "./pass.js";

/** 15/30/45 are diagnostics. 60 minutes is the exit. A late quote is not the exit. */
export const OBSERVATION_DELAYS_MS = [...DIAGNOSTIC_DELAYS_MS, EXPERIMENT_HORIZON_MS] as const;
export const LATENESS_GRACE_MS = EXPERIMENT_LATENESS_MS;

export function scheduleObservations(
  t0: Date,
): Array<{ dueAt: Date; label: string; role: "diagnostic" | "exit" }> {
  const labels = ["15m", "30m", "45m", "60m"] as const;
  return OBSERVATION_DELAYS_MS.map((delay, index) => ({
    dueAt: new Date(t0.getTime() + delay),
    label: labels[index] ?? "60m",
    role: index === OBSERVATION_DELAYS_MS.length - 1 ? "exit" : "diagnostic",
  }));
}

export function observationLabel(input: {
  scheduledLabel: string;
  dueAt: Date;
  observedAt: Date;
}): {
  label: string;
  late: boolean;
} {
  const late = input.observedAt.getTime() - input.dueAt.getTime() > LATENESS_GRACE_MS;
  return { label: late ? "late" : input.scheduledLabel, late };
}

/** The outcome job prices a candidate one hour after it was logged. */
export const OUTCOME_DELAY_MS = 60 * 60 * 1000;

/** Reproducible draw that is not alphabetical in the mint. */
export function rankKey(mint: string, now: Date): number {
  const text = `${now.toISOString()}:${mint}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface CandidateLogRow {
  mint: string;
  stage: Stage;
  group: string;
  verdict: "pass" | "fail" | "watch" | "skipped" | "unscreened";
  reason: string;
  recordedOnly: boolean;
  duringPause: boolean;
  alertPriceUsd: number | null;
  outcomeDueAt: Date;
  /** Same quote plan for a wallet, its control, and the pre-screen benchmark. */
  execution?: {
    enrolledAt: Date;
    entryAt: Date;
    eventAt: Date | null;
    venue: string;
    intendedSpendUsd: number;
    route: "unknown";
    feeHighUsd: number;
    feeLowUsd: number;
    acquiredQtyHigh: number | null;
    acquiredQtyLow: number | null;
    entryQuoteUsd: number | null;
    decisionLatencyMs: number | null;
    facts: Record<string, unknown>;
  };
}

/**
 * One row per coin the pass can see, plus recorded-only controls.
 * The 3% pause does not drop these rows. They are not positions and use no bankroll.
 */
export function buildCandidateLog(input: {
  now: Date;
  coins: readonly (ScoreCoin & ScreenFacts & { poolType?: string | null })[];
  rules: ScreenRules;
  paused: boolean;
  entries: readonly PlannedEntry[];
  prices: ReadonlyMap<string, number | null>;
  /** Freshly graduated 1:1 controls and a separate pre-screen draw. */
  experiment?: boolean;
  venueAllowlist?: readonly string[];
}): CandidateLogRow[] {
  const rows: CandidateLogRow[] = [];
  const used = new Set<string>();
  const due = new Date(input.now.getTime() + OUTCOME_DELAY_MS);
  for (const coin of input.coins) {
    if (isFlapMint(coin.mint)) continue;
    const stage = stageForCoin(coin, input.now);
    if (!stage) continue;
    const key = `${coin.mint}:${stage}`;
    if (used.has(key)) continue;
    used.add(key);
    const screen = screenCoin(coin, input.rules);
    const price = input.prices.get(coin.mint) ?? null;
    const base = {
      mint: coin.mint,
      stage,
      alertPriceUsd: price,
      outcomeDueAt: due,
      duringPause: input.paused,
    };
    if (screen.verdict === "fail") {
      rows.push({
        ...base,
        group: `screen_failed:${screen.hard.join(";") || "unspecified"}`,
        verdict: "fail",
        reason: screen.hard.join("; ") || "screen fail",
        recordedOnly: true,
      });
      continue;
    }
    if (screen.verdict === "watch") {
      rows.push({
        ...base,
        group: "watch",
        verdict: "watch",
        reason: screen.warnings.join("; ") || "unmeasured",
        recordedOnly: true,
      });
      continue;
    }
    const entered = input.entries.find(
      (entry) => entry.mint === coin.mint && entry.stage === stage,
    );
    if (entered) {
      rows.push({
        ...base,
        group: entered.arm === "wallets_x_screen" ? "wallet" : entered.arm,
        verdict: "pass",
        reason: entered.heldReason ?? "entered",
        recordedOnly: false,
        duringPause: false,
      });
      continue;
    }
    if (stage === "trench" && coin.trackedBuyers < 1) {
      rows.push({
        ...base,
        group: "screen_no_wallet",
        verdict: "pass",
        reason: input.paused ? "during_pause" : "no tracked buyer",
        recordedOnly: true,
      });
      continue;
    }
    rows.push({
      ...base,
      group: input.paused ? "wallet" : "skipped",
      verdict: input.paused ? "pass" : "skipped",
      reason: input.paused ? "during_pause" : "not entered",
      recordedOnly: true,
    });
  }
  const walletCount = rows.filter((row) => row.group === "wallet").length;
  const walletMints = new Set(rows.filter((row) => row.group === "wallet").map((row) => row.mint));
  if (input.experiment === true) {
    applyExperimentControls(rows, {
      ...input,
      prices: input.prices,
      venueAllowlist: input.venueAllowlist,
    });
    return rows;
  }
  const pool = input.coins.filter((coin) => {
    const stage = stageForCoin(coin, input.now);
    return stage === "trench" && !walletMints.has(coin.mint) && !isFlapMint(coin.mint);
  });
  const draw = [...pool]
    .sort((left, right) => rankKey(left.mint, input.now) - rankKey(right.mint, input.now))
    .slice(0, Math.max(walletCount, 0));
  for (const coin of draw) {
    const stage = stageForCoin(coin, input.now);
    if (!stage) continue;
    rows.push({
      mint: coin.mint,
      stage,
      group: "random_unscreened",
      verdict: "unscreened",
      reason: "same stage and pass, screen not applied",
      recordedOnly: true,
      duringPause: input.paused,
      alertPriceUsd: input.prices.get(coin.mint) ?? null,
      outcomeDueAt: due,
    });
  }
  return rows;
}

function applyExperimentControls(
  rows: CandidateLogRow[],
  input: {
    now: Date;
    coins: readonly (ScoreCoin & ScreenFacts & { poolType?: string | null })[];
    rules: ScreenRules;
    prices: ReadonlyMap<string, number | null>;
    venueAllowlist?: readonly string[];
  },
): void {
  const stratumFor = (coin: ScoreCoin & { poolType?: string | null }): StratumCoin | null => {
    if (!coin.graduatedAt) return null;
    const minutes = (input.now.getTime() - coin.graduatedAt.getTime()) / 60_000;
    if (minutes < 0 || minutes > 30) return null;
    return {
      mint: coin.mint,
      venue: coin.poolType ?? "unknown",
      liquidityUsd: coin.liquidityUsd,
      minutesSinceGraduation: minutes,
      hourUtc: input.now.getUTCHours(),
    };
  };
  const decisionAt = input.now.toISOString();
  const asMatch = (coin: StratumCoin): MatchCoin => ({ ...coin, decisionAt });
  const allowlist = input.venueAllowlist ?? [];
  const graduated = input.coins.flatMap((coin) => {
    const stratum = stratumFor(coin);
    if (!stratum || screenCoin(coin, input.rules).verdict !== "pass") return [];
    return [{ coin, stratum }];
  });
  const wallets = graduated.filter((row) => row.coin.trackedBuyers >= 1).map((row) => row.stratum);
  const screened = graduated.filter((row) => row.coin.trackedBuyers < 1).map((row) => row.stratum);
  const matched = matchContemporaneous({
    wallets: wallets.map(asMatch),
    screened: screened.map(asMatch),
    allowlist,
  });
  const byMint = new Map(rows.map((row) => [row.mint, row]));
  for (const pair of matched.pairs) {
    const row = byMint.get(pair.control);
    if (!row) continue;
    row.group = "screened_control";
    row.reason = pair.tier;
    row.recordedOnly = true;
  }
  for (const missed of matched.unmatched) {
    const row = byMint.get(missed.wallet);
    if (!row) continue;
    row.reason = `${row.reason}; unmatched ${missed.reason}`;
  }
  const exclude = new Set<string>([
    ...wallets.map((row) => row.mint),
    ...matched.pairs.map((pair) => pair.control),
  ]);
  const benchmarkPool = input.coins.flatMap((coin) => {
    const stratum = stratumFor(coin);
    if (!stratum || exclude.has(coin.mint)) return [];
    return [stratum];
  });
  const benchmark = matchBenchmark({
    wallets: wallets.map(asMatch),
    universe: benchmarkPool.map(asMatch),
    enrolled: exclude,
    allowlist,
  });
  for (const pair of benchmark.pairs) {
    const row = byMint.get(pair.benchmark);
    if (!row || row.group === "wallet" || row.group === "screened_control") continue;
    row.reason = `pre_screen benchmark; ${pair.tier}; prior ${row.group}`;
    row.group = "pre_screen";
    row.recordedOnly = true;
  }
  const stamp = (mint: string) => {
    const row = byMint.get(mint);
    const coin = input.coins.find((item) => item.mint === mint);
    if (!row || !coin?.graduatedAt) return;
    const timeline = enrollmentTimeline({
      graduatedAt: coin.graduatedAt,
      infoReceivedAt: input.now,
    });
    if (!timeline.eligible) return;
    const price = input.prices.get(mint) ?? row.alertPriceUsd;
    const record = executionRecord({
      entryQuoteUsd: price,
      eventAt: coin.graduatedAt,
      decidedAt: timeline.enrolledAt,
    });
    row.execution = {
      enrolledAt: timeline.enrolledAt,
      entryAt: timeline.entryAt,
      eventAt: coin.graduatedAt,
      venue: coin.poolType ?? "unknown",
      ...record,
      facts: {
        group: row.group,
        venue: coin.poolType ?? "unknown",
        liquidityUsd: coin.liquidityUsd,
        top10HoldersPct: coin.top10HoldersPct,
        sniperBundlePct: coin.sniperBundlePct,
        creatorSells: coin.creatorSells,
        trackedBuyers: coin.trackedBuyers,
      },
    };
    row.outcomeDueAt = new Date(timeline.entryAt.getTime() + EXPERIMENT_HORIZON_MS);
  };
  for (const mint of wallets.map((row) => row.mint)) stamp(mint);
  for (const pair of matched.pairs) stamp(pair.control);
  for (const pair of benchmark.pairs) stamp(pair.benchmark);
}

/** A missing follow-up quote is missing, not a loss. */
export function outcomeFromPrices(
  alertPriceUsd: number | null,
  exitPriceUsd: number | null,
): { status: "priced" | "missing"; priceUsd: number | null; net: number | null } {
  if (
    !(alertPriceUsd !== null && alertPriceUsd > 0) ||
    !(exitPriceUsd !== null && exitPriceUsd > 0)
  ) {
    return { status: "missing", priceUsd: exitPriceUsd, net: null };
  }
  return { status: "priced", priceUsd: exitPriceUsd, net: exitPriceUsd / alertPriceUsd - 1 };
}
