import { describe, expect, it } from "vitest";

import {
  JUPITER_ULTRA_EXECUTE_URL,
  JUPITER_ULTRA_ORDER_URL,
  emptyCost,
  replacementAllowed,
  reviewInstructions,
} from "./contract.js";

const destination = "dest";

describe("execution contract", () => {
  it("names the Jupiter Ultra order and execute endpoints", () => {
    expect(JUPITER_ULTRA_ORDER_URL).toBe("https://api.jup.ag/ultra/v1/order");
    expect(JUPITER_ULTRA_EXECUTE_URL).toBe("https://api.jup.ag/ultra/v1/execute");
  });

  it("keeps an uncertain submission from becoming another buy", () => {
    expect(replacementAllowed("uncertain")).toBe(false);
    expect(replacementAllowed("submitted")).toBe(false);
    expect(replacementAllowed("rejected")).toBe(true);
  });

  it("rejects an unknown program, a wrong destination, and an amount above the reservation", () => {
    const base = {
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      destination,
      amount: 10,
    };
    expect(
      reviewInstructions({
        instructions: [base],
        reservedAmount: 10,
        allowedDestination: destination,
      }),
    ).toEqual({ ok: true });
    expect(
      reviewInstructions({
        instructions: [{ ...base, programId: "not-a-program" }],
        reservedAmount: 10,
        allowedDestination: destination,
      }).ok,
    ).toBe(false);
    expect(
      reviewInstructions({
        instructions: [{ ...base, amount: 11 }],
        reservedAmount: 10,
        allowedDestination: destination,
      }),
    ).toEqual({ ok: false, reason: "above_reservation" });
  });

  it("records unknown cost parts as null", () => {
    expect(emptyCost().platformFee).toBeNull();
  });
});
