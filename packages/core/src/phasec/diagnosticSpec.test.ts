import { describe, expect, it } from "vitest";

import {
  CANDIDATE_VENUES,
  DIAGNOSTIC_BUDGET,
  DIAGNOSTIC_WALLET_LIST_VERSION,
  diagnosticBudgetStop,
  diagnosticWindow,
  exactBinomialLower,
  selectDiagnosticVenue,
  venuePasses,
  type VenueCounts,
} from "./diagnosticSpec.js";

const full = (id: string, trials: number): VenueCounts => ({
  id,
  graduationEvents: 300,
  referenceEventsByClass: { graduation: 300, migration: 300 },
  walletBuys: 300,
  walletSells: 300,
  scansComplete: true,
  recallSuccesses: trials,
  recallTrials: trials,
});

describe("diagnostic specification", () => {
  it("puts the one-sided 95 percent lower limit for 300 of 300 just above 99 percent", () => {
    expect(exactBinomialLower(300, 300)).toBeCloseTo(0.99006, 5);
    expect(exactBinomialLower(300, 300)).toBeGreaterThanOrEqual(0.99);
    expect(venuePasses(full("pump", 300))).toBe(true);
    expect(exactBinomialLower(299, 300)).toBeLessThan(0.99);
    expect(exactBinomialLower(999, 1000)).toBeCloseTo(0.995265, 5);
    expect(exactBinomialLower(999, 1000)).toBeGreaterThanOrEqual(0.99);
    expect(venuePasses({ ...full("pump", 300), recallSuccesses: 299 })).toBe(false);
    expect(venuePasses({ ...full("pump", 1000), recallSuccesses: 999, recallTrials: 1000 })).toBe(
      true,
    );
  });

  it("waits until the fixed end and does not extend", () => {
    const start = new Date("2026-12-01T00:00:00Z");
    const window = diagnosticWindow(start);
    expect(window.extension).toBe("none");
    expect(window.warmupEnd.toISOString()).toBe("2026-12-02T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-12-09T00:00:00.000Z");
    expect(
      selectDiagnosticVenue({
        now: new Date("2026-12-08T00:00:00Z"),
        end: window.end,
        earlyStop: "none",
        venues: [full("pump", 300)],
      }).status,
    ).toBe("wait");
    expect(
      selectDiagnosticVenue({
        now: window.end,
        end: window.end,
        earlyStop: "none",
        venues: [full("pump", 400), full("meteora", 300)],
      }),
    ).toEqual({ status: "selected", venue: "pump" });
    expect(
      selectDiagnosticVenue({
        now: window.end,
        end: window.end,
        earlyStop: "none",
        venues: [full("pump", 300), full("meteora", 300)],
      }),
    ).toEqual({ status: "tie", venue: null });
    expect(
      selectDiagnosticVenue({
        now: window.end,
        end: window.end,
        earlyStop: "none",
        venues: [{ ...full("pump", 300), graduationEvents: 10 }],
      }),
    ).toEqual({ status: "gap", venue: null });
    expect(
      selectDiagnosticVenue({
        now: window.end,
        end: window.end,
        earlyStop: "none",
        venues: [{ ...full("pump", 300), recallSuccesses: 299 }],
      }).status,
    ).toBe("recall_below_99");
    expect(
      selectDiagnosticVenue({
        now: new Date("2026-12-03T00:00:00Z"),
        end: window.end,
        earlyStop: "budget",
        venues: [full("pump", 300)],
      }).status,
    ).toBe("budget");
  });

  it("stops on the hard ceilings and keeps pumpswap as a destination only", () => {
    expect(
      diagnosticBudgetStop({
        heliusCredits: 50_001,
        jupiterQuotesToday: 0,
        publicRpcCallsToday: 0,
      }),
    ).toEqual({
      stop: true,
      reason: "helius",
    });
    expect(DIAGNOSTIC_BUDGET.maxJupiterQuotesPerDay).toBe(2_000);
    expect(DIAGNOSTIC_BUDGET.incrementalCeilingUsd).toBe(25);
    expect(CANDIDATE_VENUES.map((venue) => venue.id)).toEqual(["pump", "launchlab", "meteora"]);
    expect(CANDIDATE_VENUES.find((venue) => venue.id === "pump")?.destinationPool).toBe("pumpswap");
    expect(DIAGNOSTIC_WALLET_LIST_VERSION).toBe("diagnostic-cohort-2026-11-24");
  });
});
