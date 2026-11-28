/**
 * Jupiter Ultra is the execution path: order, then sign, then execute.
 * This module does not send an order and does not load a production key.
 */

export const JUPITER_ULTRA_ORDER_URL = "https://api.jup.ag/ultra/v1/order";
export const JUPITER_ULTRA_EXECUTE_URL = "https://api.jup.ag/ultra/v1/execute";

export const EXECUTION_STATES = [
  "intent",
  "quoted",
  "reserved",
  "signing",
  "submitted",
  "uncertain",
  "confirmed",
  "rejected",
  "unfilled",
  "exit_pending",
  "exit_unsuccessful",
  "reconciled",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

export interface ExecutionCost {
  platformFee: number | null;
  networkFee: number | null;
  tip: number | null;
  tokenAccountRent: number | null;
  failedTransactionCost: number | null;
  poolFee: number | null;
  slippage: number | null;
}

export interface RouteCoverage {
  stage: "trench" | "near_graduation" | "post_graduation" | "second_wave";
  buy: "available" | "unavailable";
  sell: "available" | "unavailable";
}

export interface ReviewedInstruction {
  programId: string;
  destination: string;
  amount: number;
}

const ALLOWED_PROGRAMS = new Set([
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "11111111111111111111111111111111",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
]);

export function emptyCost(): ExecutionCost {
  return {
    platformFee: null,
    networkFee: null,
    tip: null,
    tokenAccountRent: null,
    failedTransactionCost: null,
    poolFee: null,
    slippage: null,
  };
}

/** A timeout while a submission is uncertain is not permission to buy again. */
export function replacementAllowed(state: ExecutionState): boolean {
  return state === "rejected" || state === "unfilled" || state === "reconciled";
}

export function reviewInstructions(input: {
  instructions: readonly ReviewedInstruction[];
  reservedAmount: number;
  allowedDestination: string;
}): { ok: true } | { ok: false; reason: string } {
  let spent = 0;
  for (const instruction of input.instructions) {
    if (!ALLOWED_PROGRAMS.has(instruction.programId)) {
      return { ok: false, reason: "program_not_allowed" };
    }
    if (instruction.destination !== input.allowedDestination) {
      return { ok: false, reason: "destination_not_allowed" };
    }
    if (!Number.isFinite(instruction.amount) || instruction.amount < 0) {
      return { ok: false, reason: "amount_invalid" };
    }
    spent += instruction.amount;
  }
  if (spent > input.reservedAmount) return { ok: false, reason: "above_reservation" };
  return { ok: true };
}
