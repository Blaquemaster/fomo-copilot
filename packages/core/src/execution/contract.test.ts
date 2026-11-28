import { describe, expect, it } from "vitest";

import {
  JUPITER_EXECUTE_URL,
  JUPITER_ORDER_URL,
  JUPITER_SWAP_V2_SCHEMA,
  emptyCost,
  maySubmitToNetwork,
  realizedWithoutDoubleCount,
  replacementAllowed,
  reviewInstructions,
  swapV2UrlAllowed,
} from "./contract.js";

const destination = "dest";

describe("swap v2 contract", () => {
  it("pins the Jupiter Swap V2 order and execute endpoints", () => {
    expect(JUPITER_SWAP_V2_SCHEMA).toBe("swap-v2-2026-11-28");
    expect(JUPITER_ORDER_URL).toBe("https://api.jup.ag/swap/v2/order");
    expect(JUPITER_EXECUTE_URL).toBe("https://api.jup.ag/swap/v2/execute");
    expect(swapV2UrlAllowed(JUPITER_ORDER_URL)).toBe(true);
    expect(swapV2UrlAllowed("https://api.jup.ag/ultra/v1/order")).toBe(false);
    expect(maySubmitToNetwork()).toBe(false);
  });

  it("does not subtract an embedded fee a second time", () => {
    const realized = realizedWithoutDoubleCount({
      realized: { ...emptyCost(), platformFee: 1, networkFee: 2 },
      embeddedInOutput: ["platformFee"],
    });
    expect(realized.platformFee).toBeNull();
    expect(realized.networkFee).toBe(2);
  });

  it("keeps an uncertain submission from becoming another buy", () => {
    expect(replacementAllowed("uncertain")).toBe(false);
    expect(replacementAllowed("submitted")).toBe(false);
    expect(replacementAllowed("rejected")).toBe(true);
  });

  it("rejects an unknown account and an amount above the reservation", () => {
    const base = {
      programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      destination,
      amount: 10,
      referencedAccounts: ["wallet"],
    };
    expect(
      reviewInstructions({
        instructions: [base],
        reservedAmount: 10,
        allowedDestination: destination,
        allowedAccounts: ["wallet"],
      }),
    ).toEqual({ ok: true });
    expect(
      reviewInstructions({
        instructions: [{ ...base, referencedAccounts: ["other"] }],
        reservedAmount: 10,
        allowedDestination: destination,
        allowedAccounts: ["wallet"],
      }).ok,
    ).toBe(false);
  });
});
