import { isFlapMint, stageForCoin, type ScoreCoin } from "./score.js";
import { screenCoin, type ScreenFacts, type ScreenRules } from "./screen.js";
import type { Stage } from "./protocol.js";
import type { PlannedEntry } from "./pass.js";

/** Scheduled executable observations. A quote taken later is not labeled as if it were on time. */
export const OBSERVATION_DELAYS_MS = [15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000] as const;
export const LATENESS_GRACE_MS = 3 * 60 * 1000;

export function scheduleObservations(t0: Date): Array<{ dueAt: Date; label: string }> {
  return [
    { dueAt: new Date(t0.getTime() + OBSERVATION_DELAYS_MS[0]), label: "15m" },
    { dueAt: new Date(t0.getTime() + OBSERVATION_DELAYS_MS[1]), label: "30m" },
    { dueAt: new Date(t0.getTime() + OBSERVATION_DELAYS_MS[2]), label: "60m" },
  ];
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
}

/**
 * One row per coin the pass can see, plus recorded-only controls.
 * The 3% pause does not drop these rows. They are not positions and use no bankroll.
 */
export function buildCandidateLog(input: {
  now: Date;
  coins: readonly (ScoreCoin & ScreenFacts)[];
  rules: ScreenRules;
  paused: boolean;
  entries: readonly PlannedEntry[];
  prices: ReadonlyMap<string, number | null>;
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
