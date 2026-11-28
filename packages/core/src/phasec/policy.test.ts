import { describe, expect, it } from "vitest";

import { POLICY_VERSION, applyEntryPolicy, positionWriteAllowed } from "./policy.js";

describe("entry policy", () => {
  it("refuses a position when the caller skips the policy", () => {
    const allowed = applyEntryPolicy({
      amount: 5,
      bankroll: 20,
      exitReserve: 5,
      route: "available",
      liquidityUsd: 1000,
      fresh: true,
    });
    expect(allowed.version).toBe(POLICY_VERSION);
    expect(positionWriteAllowed(allowed)).toEqual({ written: true, reason: POLICY_VERSION });
    expect(positionWriteAllowed(null)).toEqual({ written: false, reason: "policy_required" });
  });
});
