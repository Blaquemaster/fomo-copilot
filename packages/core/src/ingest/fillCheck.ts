import { SOL_MINT } from "../phasec/quote.js";

/**
 * 0.002 SOL is the experiment's minimum buy. It is a strategy parameter.
 * A smaller sell still counts. Wrapped SOL is the payment leg of a swap, not the coin.
 * A native SOL change with no token amount is rent, a fee, or a transfer, not a purchase.
 */
export const RENT_DOMINATED_SOL = 0.002;

export function fillAmountUsable(input: {
  mint: string;
  solAmount: number | null;
  tokenAmount: number | null;
  side?: "buy" | "sell" | "swap";
}): { usable: boolean; reason: string } {
  if (input.mint === SOL_MINT)
    return { usable: false, reason: "wrapped sol payment leg, not the coin" };
  if (input.tokenAmount === null && input.solAmount !== null) {
    return { usable: false, reason: "sol change alone is not a purchase" };
  }
  if (input.tokenAmount === null || input.solAmount === null) {
    return { usable: false, reason: "amount missing" };
  }
  if (input.side === "sell" || input.tokenAmount < 0) {
    return { usable: true, reason: "sell counts even below the minimum buy" };
  }
  if (Math.abs(input.solAmount) < RENT_DOMINATED_SOL) {
    return { usable: false, reason: "buy is inside the 0.002 SOL minimum" };
  }
  return { usable: true, reason: "quantity usable" };
}

export interface ActivityFill {
  signature: string;
  mint: string;
  side: "buy" | "sell" | "swap" | "unknown";
  solAmount: number | null;
  tokenAmount: number | null;
  venue: string;
  /** False when the row was not priced. It still counts toward the 24h activity filter. */
  priced?: boolean;
}

/**
 * Keep the wrapped-SOL leg as the payment on the same signature.
 * A sell below 0.002 SOL still counts. SOL with no token amount is not a purchase.
 * An unclassified leg makes the whole signature unknown.
 */
export function reconstructActivity(fills: readonly ActivityFill[]): {
  paymentLegs: ActivityFill[];
  coinLegs: ActivityFill[];
  status: "net_buyer" | "flat_or_sold" | "unknown";
  venues: string[];
  activityCount: number;
} {
  const wrapped = SOL_MINT;
  const paymentLegs = fills.filter((fill) => fill.mint === wrapped);
  const coinLegs = fills.filter((fill) => fill.mint !== wrapped);
  const unclassified = coinLegs.some(
    (fill) => fill.side === "unknown" || (fill.tokenAmount === null && fill.solAmount === null),
  );
  const solOnly = fills.some(
    (fill) => fill.mint !== wrapped && fill.tokenAmount === null && fill.solAmount !== null,
  );
  let net = 0;
  for (const fill of coinLegs) {
    if (fill.tokenAmount === null) continue;
    if (fill.side === "sell" || fill.tokenAmount < 0) {
      net += fill.tokenAmount;
      continue;
    }
    if (fill.solAmount !== null && Math.abs(fill.solAmount) >= RENT_DOMINATED_SOL)
      net += fill.tokenAmount;
  }
  return {
    paymentLegs,
    coinLegs,
    status: unclassified || solOnly ? "unknown" : net > 0 ? "net_buyer" : "flat_or_sold",
    venues: [...new Set(fills.map((fill) => fill.venue))],
    activityCount: fills.length,
  };
}
