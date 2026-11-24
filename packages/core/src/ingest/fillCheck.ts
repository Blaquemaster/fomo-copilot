import { SOL_MINT } from "../phasec/quote.js";

/**
 * Below this SOL change, account rent and fees dominate. The number is not a trade size.
 * Wrapped SOL and a missing token amount are not a token quantity.
 */
export const RENT_DOMINATED_SOL = 0.002;

export function fillAmountUsable(input: {
  mint: string;
  solAmount: number | null;
  tokenAmount: number | null;
}): { usable: boolean; reason: string } {
  if (input.mint === SOL_MINT) return { usable: false, reason: "wrapped sol is not a coin trade" };
  if (input.tokenAmount === null || input.solAmount === null) {
    return { usable: false, reason: "amount missing" };
  }
  if (Math.abs(input.solAmount) < RENT_DOMINATED_SOL) {
    return { usable: false, reason: "sol change is inside rent and fees" };
  }
  return { usable: true, reason: "quantity usable" };
}
