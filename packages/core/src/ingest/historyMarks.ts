import type { EarlyBuy } from "./wallets.js";

export const HISTORY_MARK_SOURCE = "history_swap" as const;
const SLOT_SECONDS = 0.4;

export interface HistorySwap {
  mint: string;
  wallet: string;
  side: "buy" | "sell";
  slot: number | null;
  blockTimeSec: number | null;
  /** SOL moved by this swap. Token amount uses the same raw unit for the mint. */
  solAmount: number | null;
  tokenAmount: number | null;
  signature?: string | null;
}

export interface HistoryMark {
  delayedMarkUsd: number;
  delayedMarkAt: Date;
  delayedMarkSource: typeof HISTORY_MARK_SOURCE;
  exitMarkUsd: number;
  boughtAt: Date;
}

function swapSeconds(swap: HistorySwap): number | null {
  if (swap.blockTimeSec !== null && Number.isFinite(swap.blockTimeSec)) return swap.blockTimeSec;
  if (swap.slot === null) return null;
  return swap.slot * SLOT_SECONDS;
}

function price(swap: HistorySwap): number | null {
  if (swap.solAmount === null || swap.tokenAmount === null) return null;
  if (!(swap.solAmount > 0) || !(swap.tokenAmount > 0)) return null;
  return swap.solAmount / swap.tokenAmount;
}

/**
 * Delayed mark is the other swap closest to t+90s, never this wallet's own entry.
 * Exit mark is the swap closest to the venue horizon. Both are SOL per token when
 * no contemporaneous SOL/USD print is stored; the ratio is what the score uses.
 * Meteora's modeled exit is still a constant-product approximation, not sqrt_price.
 */
export function historyMarkForBuy(input: {
  buy: HistorySwap;
  swaps: readonly HistorySwap[];
  delaySec?: number;
  horizonSec: number;
}): HistoryMark | null {
  const delay = input.delaySec ?? 90;
  const buyAt = swapSeconds(input.buy);
  if (buyAt === null) return null;
  const others = input.swaps.filter((swap) => {
    if (swap.mint !== input.buy.mint) return false;
    if (swap.signature && input.buy.signature && swap.signature === input.buy.signature) {
      return false;
    }
    if (
      swap.wallet === input.buy.wallet &&
      swap.slot !== null &&
      swap.slot === input.buy.slot &&
      swap.side === input.buy.side
    ) {
      return false;
    }
    return price(swap) !== null && swapSeconds(swap) !== null;
  });
  const delayedTarget = buyAt + delay;
  const delayed = closest(others, delayedTarget, buyAt + 60, buyAt + 120);
  const exitTarget = buyAt + input.horizonSec;
  const exit = closest(others, exitTarget, exitTarget - 15 * 60, exitTarget + 15 * 60);
  if (!delayed || !exit) return null;
  const delayedPrice = price(delayed);
  const exitPrice = price(exit);
  const delayedAt = swapSeconds(delayed);
  const bought = swapSeconds(input.buy);
  if (delayedPrice === null || exitPrice === null || delayedAt === null || bought === null) {
    return null;
  }
  return {
    delayedMarkUsd: delayedPrice,
    delayedMarkAt: new Date(delayedAt * 1000),
    delayedMarkSource: HISTORY_MARK_SOURCE,
    exitMarkUsd: exitPrice,
    boughtAt: new Date(bought * 1000),
  };
}

function closest(
  swaps: readonly HistorySwap[],
  target: number,
  start: number,
  end: number,
): HistorySwap | null {
  let best: HistorySwap | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const swap of swaps) {
    const at = swapSeconds(swap);
    if (at === null || at < start || at > end) continue;
    const distance = Math.abs(at - target);
    if (distance < bestDistance) {
      best = swap;
      bestDistance = distance;
    }
  }
  return best;
}

export function horizonSecForVenue(venue: string | null | undefined): number {
  return venue === "meteora" || venue === "dbc" ? 60 * 60 : 2 * 60 * 60;
}

/** Fill delayed and exit marks from stored swaps. Rows that already have both marks are kept. */
export function applyHistoryMarks(rows: readonly EarlyBuy[]): EarlyBuy[] {
  const swaps: HistorySwap[] = rows.flatMap((row) => {
    if (row.solAmount == null || row.tokenAmount == null) return [];
    return [
      {
        mint: row.mint,
        wallet: row.wallet,
        side: row.side,
        slot: row.slot ?? null,
        blockTimeSec: row.blockTimeSec ?? null,
        solAmount: row.solAmount,
        tokenAmount: row.tokenAmount,
        signature: row.signature ?? null,
      },
    ];
  });
  return rows.map((row) => {
    if (row.side !== "buy" || (row.delayedMarkUsd != null && row.exitMarkUsd != null)) return row;
    const mark = historyMarkForBuy({
      buy: {
        mint: row.mint,
        wallet: row.wallet,
        side: row.side,
        slot: row.slot ?? null,
        blockTimeSec: row.blockTimeSec ?? null,
        solAmount: row.solAmount ?? null,
        tokenAmount: row.tokenAmount ?? null,
        signature: row.signature ?? null,
      },
      swaps,
      horizonSec: horizonSecForVenue(row.venue),
    });
    if (!mark) return row;
    return { ...row, ...mark };
  });
}
