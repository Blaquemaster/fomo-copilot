import { EXIT_PLAN, type Stage } from "./protocol.js";

/** Cap a stage size to a share of pool liquidity. Unknown liquidity is left unchanged. */
export function capSizeToLiquidity(
  sizeUsd: number | null,
  liquidityUsd: number | null,
  share: number,
): number | null {
  if (sizeUsd === null) return null;
  if (!(sizeUsd > 0) || !(share > 0) || liquidityUsd === null || !(liquidityUsd > 0))
    return sizeUsd;
  return Math.min(sizeUsd, liquidityUsd * share);
}

export function sizeForStage(
  stage: Stage,
  sizePct: Record<Stage, number>,
  bankroll: number | null,
): { pct: number; amount: number | null } {
  const pct = sizePct[stage];
  const amount = bankroll === null ? null : (bankroll * pct) / 100;
  return { pct, amount };
}

export function bankrollLossPct(rows: readonly { sizePct: number; netReturn: number }[]): number {
  const fraction = rows.reduce((sum, row) => sum + (row.sizePct / 100) * row.netReturn, 0);
  return -Math.min(0, fraction) * 100;
}

export function shouldPauseDay(lossPct: number, cutoffPct: number): boolean {
  return lossPct >= cutoffPct;
}

export function entryDecision(input: {
  openCount: number;
  maxConcurrent: number;
  mintBusy: boolean;
  exitPlan: string;
  paused: boolean;
}): { ok: true } | { ok: false; reason: "paused" | "concurrent" | "averaging_down" | "exit_plan" } {
  if (input.exitPlan.trim().length === 0) return { ok: false, reason: "exit_plan" };
  if (input.paused) return { ok: false, reason: "paused" };
  if (input.mintBusy) return { ok: false, reason: "averaging_down" };
  if (input.openCount >= input.maxConcurrent) return { ok: false, reason: "concurrent" };
  return { ok: true };
}

export function exitPlanText(): string {
  return EXIT_PLAN;
}

export interface TierWallet {
  address: string;
  hitRate: number;
  tier: "base" | "high";
}

export function planTierPromotions(
  wallets: readonly TierWallet[],
  promoteRate: number,
  pending: ReadonlySet<string>,
): Array<{ wallet: string; from: "base"; to: "high" }> {
  const requests: Array<{ wallet: string; from: "base"; to: "high" }> = [];
  for (const wallet of wallets) {
    if (wallet.tier === "high") continue;
    if (wallet.hitRate < promoteRate) continue;
    if (pending.has(wallet.address)) continue;
    requests.push({ wallet: wallet.address, from: "base", to: "high" });
  }
  return requests;
}
