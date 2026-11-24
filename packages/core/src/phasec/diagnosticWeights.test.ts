import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_HELIUS_METHODS,
  HELIUS_DIAGNOSTIC_ENDPOINTS,
  boundedScanBudget,
  heliusDiagnosticCredits,
} from "./diagnosticSpend.js";

describe("helius diagnostic weights", () => {
  it("names the endpoint for each weight and bills the documented credits", () => {
    expect(HELIUS_DIAGNOSTIC_ENDPOINTS.enhancedTransactions.endpoint).toBe(
      "GET https://api.helius.xyz/v0/addresses/{address}/transactions",
    );
    expect(HELIUS_DIAGNOSTIC_ENDPOINTS.enhancedTransactions.credits).toBe(100);
    expect(heliusDiagnosticCredits("enhancedTransactions")).toBe(100);
    expect(heliusDiagnosticCredits("parsedEventsRest")).toBe(100);

    expect(HELIUS_DIAGNOSTIC_ENDPOINTS.parsedEventsScan.endpoint).toBe(
      "POST https://mainnet.helius-rpc.com/v1/parsed-events/scan",
    );
    expect(heliusDiagnosticCredits("parsedEventsScan", { historyPages: 0 })).toBe(10);
    expect(heliusDiagnosticCredits("parsedEventsScan", { historyPages: 1 })).toBe(11);
    expect(heliusDiagnosticCredits("parsedEventsScan", { transactionsScanned: 2000 })).toBe(12);
    expect(boundedScanBudget(10_000)).toEqual({
      allowed: true,
      maxScanned: 10_000,
      historyPages: 10,
      reservedCredits: 20,
    });
    expect(boundedScanBudget(10_001).allowed).toBe(false);

    expect(HELIUS_DIAGNOSTIC_ENDPOINTS.parsedStreamDelivery.endpoint).toBe(
      "parsedTransactionSubscribe delivery",
    );
    expect(heliusDiagnosticCredits("parsedStreamDelivery", { deliveredEvents: 1 })).toBe(1);
    expect(heliusDiagnosticCredits("parsedStreamDelivery", { deliveredEvents: 4 })).toBe(4);
  });

  it("charges the diagnostic runner for the scan endpoint only", () => {
    expect(DIAGNOSTIC_HELIUS_METHODS).toEqual(["parsedEventsScan"]);
  });
});
