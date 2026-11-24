import { describe, expect, it } from "vitest";

import { shadowAcceptance, type ShadowMeasurements } from "./shadowReport.js";

function passing(): ShadowMeasurements {
  return {
    tradesCreated: 0,
    telegramSends: 0,
    autoEnabled: false,
    unintendedProdWrites: 0,
    recall: [{ venue: "pump", observed: 297, reference: 300 }],
    dispatchWithin60s: 100,
    dispatchAttempts: 100,
    silentDrops: 0,
    peakRequests: 7,
    peakCapacity: 10,
    unresolvedByArm: [{ arm: "wallet", unresolved: 1, endpoints: 100 }],
    completeMatched: 20,
    projectedWalletPerDay: 3,
    cashReconciled: true,
    timelyRecall: [{ venue: "pump", observed: 297, reference: 300 }],
    eventualRecall: [{ venue: "pump", observed: 300, reference: 300 }],
    healthyPeriodCoverage: 0.99,
    wholeRunAvailability: 0.9,
    matchedGatePassing: 20,
    capRelaxed: false,
    integrityFailure: false,
    spendLimitHit: false,
    unsafeOperation: false,
  };
}

describe("shadow acceptance", () => {
  it("passes the written criteria and has no return field", () => {
    const result = shadowAcceptance(passing());
    expect(result.pass).toBe(true);
    expect(result.checks).not.toHaveProperty("returns");
  });

  it("fails isolation, thin recall, a late scheduler, and a missing-data arm", () => {
    const isolated = shadowAcceptance({ ...passing(), telegramSends: 1 });
    expect(isolated.checks["isolation"]).toBe(false);
    const thin = shadowAcceptance({
      ...passing(),
      recall: [{ venue: "pump", observed: 100, reference: 100 }],
    });
    expect(thin.checks["recall"]).toBe(false);
    const late = shadowAcceptance({ ...passing(), dispatchWithin60s: 90 });
    expect(late.checks["scheduler"]).toBe(false);
    const missing = shadowAcceptance({
      ...passing(),
      unresolvedByArm: [{ arm: "wallet", unresolved: 5, endpoints: 100 }],
    });
    expect(missing.checks["missing"]).toBe(false);
    expect(missing.pass).toBe(false);
  });
});
