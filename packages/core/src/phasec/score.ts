import {
  POST_GRAD_MINUTES,
  TRENCH_MAX_AGE_MIN,
  mintBucket,
  type PaperArm,
  type PhaseCConfig,
  type Stage,
} from "./protocol.js";
import type { MarketQuote } from "./market.js";

export interface ScoreCoin {
  mint: string;
  createdAt: Date;
  graduatedAt: Date | null;
  curveCompletedAt: Date | null;
  trackedBuyers: number;
  /** Null when the X source is off. Absence is not a penalty. */
  xMentions: number | null;
  liquidityUsd: number | null;
}

export function stageForCoin(
  coin: ScoreCoin,
  now: Date,
  quote: MarketQuote | null,
  config: Pick<PhaseCConfig, "secondWaveMinChangePct">,
): Stage | null {
  if (coin.graduatedAt) {
    const sinceMin = (now.getTime() - coin.graduatedAt.getTime()) / 60_000;
    if (sinceMin <= POST_GRAD_MINUTES) return "post_graduation";
    const change = quote?.priceChange1hPct;
    if (change !== null && change !== undefined && change >= config.secondWaveMinChangePct) {
      return "second_wave";
    }
    return null;
  }
  if (coin.curveCompletedAt) return "near_graduation";
  const ageMin = (now.getTime() - coin.createdAt.getTime()) / 60_000;
  if (ageMin >= 0 && ageMin <= TRENCH_MAX_AGE_MIN) return "trench";
  return null;
}

export function scoreStrength(stage: Stage, coin: ScoreCoin): number {
  let score = 0.35;
  if (stage === "post_graduation") score += 0.2;
  if (stage === "near_graduation") score += 0.1;
  if (coin.trackedBuyers >= 1) score += 0.2;
  if (coin.trackedBuyers >= 3) score += 0.1;
  if (coin.xMentions !== null && coin.xMentions >= 2) score += 0.15;
  if ((coin.liquidityUsd ?? 0) >= 15_000) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}

/** Pre-registered. The hash is the control and the second-wave split. X does not choose the arm. */
export function assignArm(mint: string, stage: Stage, trackedBuyers: number): PaperArm {
  if (stage === "second_wave") {
    return mintBucket(mint, 2) === 0 ? "second_wave_a" : "second_wave_b";
  }
  if (mintBucket(mint, 5) === 0) return "random_pass";
  if (trackedBuyers >= 1) return "wallets_x_screen";
  return "screen_only";
}
