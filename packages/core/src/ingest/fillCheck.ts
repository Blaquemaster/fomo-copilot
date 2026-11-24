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
