import type { PaperArm } from "./protocol.js";
import { etWeekStart } from "./time.js";

export interface ResolvedReturn {
  at: Date;
  arm: PaperArm;
  net: number;
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
  mean: number | null;
  maxDrawdownPct: number;
  weeks: WeekSplit[];
}

export function quotedNetReturn(
  entry: number,
  exit: number,
  feeBps: number,
  slippageBps: number,
): number | null {
  if (!(entry > 0) || !(exit > 0)) return null;
  const cost = (2 * (feeBps + slippageBps)) / 10_000;
  return exit / entry - 1 - cost;
}

export function maxDrawdownPct(returns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= 1 + value;
    if (equity > peak) peak = equity;
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst * 100;
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
  returns: readonly ResolvedReturn[];
}): PaperEvaluation {
  const ordered = [...input.returns].sort((left, right) => left.at.getTime() - right.at.getTime());
  const mean =
    ordered.length === 0 ? null : ordered.reduce((sum, row) => sum + row.net, 0) / ordered.length;
  const drawdown = maxDrawdownPct(ordered.map((row) => row.net));
  const windowEnd = input.registeredAt.getTime() + input.windowDays * 24 * 60 * 60 * 1000;
  let status: PaperEvaluation["status"];
  if (ordered.length < input.minAlerts) {
    status = input.now.getTime() < windowEnd ? "collecting" : "extend";
  } else if (mean !== null && mean > 0 && drawdown < input.maxDrawdownPct) {
    status = "go";
  } else {
    status = "no_go";
  }
  return {
    status,
    alerts: ordered.length,
    mean,
    maxDrawdownPct: drawdown,
    weeks: weeklySplits(ordered),
  };
}
