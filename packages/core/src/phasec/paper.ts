import type { PaperArm } from "./protocol.js";
import { etWeekStart } from "./time.js";

export interface ResolvedReturn {
  at: Date;
  arm: PaperArm;
  /** Fraction of the position, after the quoted round trip. -1 is a full loss. */
  net: number;
  /** Stage size as a percent of bankroll. The equity curve uses this, not 100. */
  sizePct: number;
}

export interface WeekSplit {
  week: string;
  arm: PaperArm | "all";
  n: number;
  mean: number;
  median: number;
  p10: number;
  p90: number;
}

export interface PaperEvaluation {
  status: "collecting" | "extend" | "go" | "no_go";
  alerts: number;
  /** Bankroll profit as a fraction. Positive means the bankroll grew. */
  bankrollPnl: number | null;
  maxDrawdownPct: number;
  weeks: WeekSplit[];
  powerSampleSize: number;
  powerWarning: string | null;
}

/** Detect a 5 point mean net return at 50% volatility, two-sided 5%. */
export function powerSampleSize(sigma = 0.5, effect = 0.05, z = 1.96): number {
  if (!(effect > 0) || !(sigma >= 0)) return 1;
  return Math.ceil(((z * sigma) / effect) ** 2);
}

export function powerWarning(
  expectedAlerts: number | null,
  needed: number,
  windowDays: number,
): string | null {
  if (expectedAlerts === null) {
    return `powered sample is ${needed.toString()}; expected alert volume was not supplied, so it cannot be shown to support that sample`;
  }
  if (expectedAlerts < needed) {
    return `powered sample is ${needed.toString()} but about ${expectedAlerts.toString()} alerts are expected in ${windowDays.toString()} days`;
  }
  return null;
}

/** Equity starts at 1. Each trade adds sizePct/100 * net. Drawdown is peak to trough of that curve. */
export function bankrollCurve(rows: readonly { sizePct: number; net: number }[]): {
  pnl: number;
  maxDrawdownPct: number;
} {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const row of rows) {
    equity += (row.sizePct / 100) * row.net;
    if (equity > peak) peak = equity;
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak);
  }
  return { pnl: equity - 1, maxDrawdownPct: worst * 100 };
}

function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  const left = sorted[low] ?? 0;
  const right = sorted[high] ?? left;
  return left + (right - left) * (index - low);
}

function split(rows: readonly number[], week: string, arm: PaperArm | "all"): WeekSplit {
  const sorted = [...rows].sort((left, right) => left - right);
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  return {
    week,
    arm,
    n: rows.length,
    mean,
    median: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p90: quantile(sorted, 0.9),
  };
}

export function weeklySplits(returns: readonly ResolvedReturn[]): WeekSplit[] {
  const groups = new Map<string, ResolvedReturn[]>();
  for (const row of returns) {
    const key = etWeekStart(row.at);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const weeks: WeekSplit[] = [];
  for (const [week, rows] of [...groups.entries()].sort(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    weeks.push(
      split(
        rows.map((row) => row.net),
        week,
        "all",
      ),
    );
    const arms = new Map<PaperArm, number[]>();
    for (const row of rows) {
      const list = arms.get(row.arm) ?? [];
      list.push(row.net);
      arms.set(row.arm, list);
    }
    for (const [arm, nets] of [...arms.entries()].sort(([left], [right]) =>
      left < right ? -1 : 1,
    )) {
      weeks.push(split(nets, week, arm));
    }
  }
  return weeks;
}

export function evaluatePaper(input: {
  registeredAt: Date;
  now: Date;
  windowDays: number;
  minAlerts: number;
  maxDrawdownPct: number;
  expectedAlerts?: number | null;
  returns: readonly ResolvedReturn[];
}): PaperEvaluation {
  const ordered = [...input.returns].sort((left, right) => left.at.getTime() - right.at.getTime());
  const curve = bankrollCurve(ordered);
  const windowEnd = input.registeredAt.getTime() + input.windowDays * 24 * 60 * 60 * 1000;
  let status: PaperEvaluation["status"];
  if (ordered.length < input.minAlerts) {
    status = input.now.getTime() < windowEnd ? "collecting" : "extend";
  } else if (curve.pnl > 0 && curve.maxDrawdownPct < input.maxDrawdownPct) {
    status = "go";
  } else {
    status = "no_go";
  }
  const needed = powerSampleSize();
  return {
    status,
    alerts: ordered.length,
    bankrollPnl: ordered.length === 0 ? null : curve.pnl,
    maxDrawdownPct: curve.maxDrawdownPct,
    weeks: weeklySplits(ordered),
    powerSampleSize: needed,
    powerWarning: powerWarning(input.expectedAlerts ?? null, needed, input.windowDays),
  };
}
