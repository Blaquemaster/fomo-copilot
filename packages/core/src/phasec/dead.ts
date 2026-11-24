/** A direct read of the pool or curve the exit would trade. */
export type PoolTradability = "tradable" | "drained" | "closed" | "no_direct_route" | "unknown";

export const DEFAULT_DEAD_STREAK = 3;
export const DEFAULT_DEAD_GAP_MS = 60_000;

export interface NoRouteStreak {
  streak: number;
  firstAt: Date | null;
  lastAt: Date | null;
}

/**
 * Count consecutive true no-route answers. HTTP and other API errors do not count.
 * Two answers closer than gapMs are one observation, so a retry inside one pass cannot
 * advance the streak.
 */
export function nextNoRouteStreak(input: {
  previous: NoRouteStreak;
  now: Date;
  gapMs: number;
  event: "no_route" | "other";
}): NoRouteStreak {
  if (input.event !== "no_route") return { streak: 0, firstAt: null, lastAt: null };
  const last = input.previous.lastAt;
  if (last && input.now.getTime() - last.getTime() < input.gapMs) return input.previous;
  return {
    streak: input.previous.streak + 1,
    firstAt: input.previous.firstAt ?? input.now,
    lastAt: input.now,
  };
}

/**
 * Book -100% only after several spaced no-route answers and on-chain evidence that
 * the pool or curve is untradable. Unknown and still-tradable pools stay unpriced.
 */
export function shouldBookDead(input: {
  streak: NoRouteStreak;
  now: Date;
  requiredStreak: number;
  gapMs: number;
  pool: PoolTradability | null;
}): boolean {
  if (input.streak.streak < input.requiredStreak) return false;
  if (!input.streak.firstAt || !input.streak.lastAt) return false;
  const span = input.streak.lastAt.getTime() - input.streak.firstAt.getTime();
  if (span < (input.requiredStreak - 1) * input.gapMs) return false;
  return input.pool === "drained" || input.pool === "closed" || input.pool === "no_direct_route";
}

export function isTrueNoRoute(reason: string): boolean {
  return reason === "no_route" || reason === "no_liquidity";
}

/** Below this virtual SOL reserve the curve is treated as drained. 0.001 SOL. */
export const DRAINED_SOL_LAMPORTS = 1_000_000n;

/**
 * Direct pool read. A missing account is closed. A reserve we can parse is drained
 * or has no constant-product output for the sell size. An account we cannot parse
 * stays unknown, which does not book a -100%.
 */
export function tradabilityFromReserves(input: {
  exists: boolean;
  virtualSolLamports: bigint | null;
  virtualTokenRaw: bigint | null;
  sellAmountRaw: bigint;
}): PoolTradability {
  if (!input.exists) return "closed";
  if (input.virtualSolLamports === null || input.virtualTokenRaw === null) return "unknown";
  if (input.virtualSolLamports <= DRAINED_SOL_LAMPORTS || input.virtualTokenRaw <= 0n) {
    return "drained";
  }
  if (input.sellAmountRaw > 0n) {
    const newToken = input.virtualTokenRaw + input.sellAmountRaw;
    if (newToken <= 0n) return "no_direct_route";
    const newSol = (input.virtualSolLamports * input.virtualTokenRaw) / newToken;
    if (input.virtualSolLamports - newSol <= 0n) return "no_direct_route";
  }
  return "tradable";
}
