/** Graduated coins watched for 30 days, and only after the first day. */

export const SECOND_WAVE_MIN_AGE_MS = 24 * 60 * 60 * 1000;
export const SECOND_WAVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type SecondWaveLabel = "breakout" | "dead" | "quiet" | "too_young" | "outside_window";

export interface SecondWaveObservation {
  mint: string;
  graduatedAt: Date | null;
  volume1hUsd: number | null;
  volume4hUsd: number | null;
  volume7dUsd: number | null;
  priceUsd: number | null;
  postGradRangeHigh: number | null;
  holderGrowthPct: number | null;
  liquidityUsd: number | null;
  liquidityGrowthPct: number | null;
  trackedBuys: number;
}

export function secondWaveSignal(obs: SecondWaveObservation, now: Date): SecondWaveLabel {
  if (!obs.graduatedAt) return "outside_window";
  const age = now.getTime() - obs.graduatedAt.getTime();
  if (age < SECOND_WAVE_MIN_AGE_MS) return "too_young";
  if (age > SECOND_WAVE_WINDOW_MS) return "outside_window";
  if (obs.liquidityUsd === 0 || obs.volume7dUsd === 0) return "dead";
  const baselineHour = obs.volume7dUsd === null ? null : obs.volume7dUsd / (24 * 7);
  const volumeBreakout =
    baselineHour !== null &&
    baselineHour > 0 &&
    ((obs.volume1hUsd !== null && obs.volume1hUsd >= baselineHour * 3) ||
      (obs.volume4hUsd !== null && obs.volume4hUsd >= baselineHour * 4 * 2));
  const aboveRange =
    obs.priceUsd !== null && obs.postGradRangeHigh !== null && obs.priceUsd > obs.postGradRangeHigh;
  const participation =
    (obs.holderGrowthPct !== null && obs.holderGrowthPct > 0) ||
    (obs.liquidityGrowthPct !== null && obs.liquidityGrowthPct > 0) ||
    obs.trackedBuys >= 1;
  if (volumeBreakout && aboveRange && participation) return "breakout";
  return "quiet";
}

export const MIHAO_MINT = "Mihao111111111111111111111111111111111111";

export function mihaoObservation(now: Date): SecondWaveObservation {
  return {
    mint: MIHAO_MINT,
    graduatedAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    volume1hUsd: 18_000,
    volume4hUsd: 40_000,
    volume7dUsd: 50_000,
    priceUsd: 0.0042,
    postGradRangeHigh: 0.003,
    holderGrowthPct: 12,
    liquidityUsd: 42_000,
    liquidityGrowthPct: 8,
    trackedBuys: 2,
  };
}

/** Zero liquidity after graduation. This must be dropped, not alerted. */
export function deadCoinObservation(now: Date): SecondWaveObservation {
  return {
    mint: "Dead1111111111111111111111111111111111111",
    graduatedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    volume1hUsd: 0,
    volume4hUsd: 0,
    volume7dUsd: 0,
    priceUsd: null,
    postGradRangeHigh: 0.01,
    holderGrowthPct: 0,
    liquidityUsd: 0,
    liquidityGrowthPct: -100,
    trackedBuys: 0,
  };
}

/** Graduated two hours ago. That is post-graduation, not a second wave. */
export function tooYoungObservation(now: Date): SecondWaveObservation {
  return {
    mint: "Young111111111111111111111111111111111111",
    graduatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
    volume1hUsd: 50_000,
    volume4hUsd: 80_000,
    volume7dUsd: 10_000,
    priceUsd: 2,
    postGradRangeHigh: 1,
    holderGrowthPct: 20,
    liquidityUsd: 30_000,
    liquidityGrowthPct: 10,
    trackedBuys: 3,
  };
}
