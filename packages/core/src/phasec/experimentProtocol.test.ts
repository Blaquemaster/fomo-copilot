import { describe, expect, it } from "vitest";

import {
  allocatedReturn,
  blockBootstrapDelta,
  classifyExitObservation,
  drawBenchmark,
  enrollmentTimeline,
  experimentCall,
  flatRoundTrip,
  matchOneToOne,
  pairedDifferences,
  threeScenarios,
  walletBuyQualifies,
  type StratumCoin,
} from "./experimentProtocol.js";

const at = (iso: string) => new Date(iso);

function coin(mint: string, overrides: Partial<StratumCoin> = {}): StratumCoin {
  return {
    mint,
    venue: "pump",
    liquidityUsd: 20_000,
    minutesSinceGraduation: 5,
    hourUtc: 12,
    ...overrides,
  };
}

describe("experiment protocol defaults", () => {
  it("freezes enrollment before the 180-second entry and refuses a late signal", () => {
    const graduatedAt = at("2026-11-24T12:00:00.000Z");
    const early = enrollmentTimeline({
      graduatedAt,
      infoReceivedAt: at("2026-11-24T11:40:00.000Z"),
    });
    expect(early.eligible).toBe(true);
    expect(early.signalAt.toISOString()).toBe("2026-11-24T12:00:00.000Z");
    expect(early.enrolledAt.toISOString()).toBe(early.signalAt.toISOString());
    expect(early.entryAt.getTime() - early.enrolledAt.getTime()).toBe(180_000);

    const inside = enrollmentTimeline({
      graduatedAt,
      infoReceivedAt: at("2026-11-24T12:02:00.000Z"),
    });
    expect(inside.entryAt.toISOString()).toBe("2026-11-24T12:05:00.000Z");

    const late = enrollmentTimeline({
      graduatedAt,
      infoReceivedAt: at("2026-11-24T12:31:00.000Z"),
    });
    expect(late.eligible).toBe(false);
    expect(late.reason).toBe("outside_graduation_window");
  });

  it("counts a wallet buy only when it was observed before enrollment, within 60 minutes", () => {
    const enrolledAt = at("2026-11-24T12:02:00.000Z");
    expect(walletBuyQualifies({ observedAt: at("2026-11-24T11:40:00.000Z"), enrolledAt })).toBe(
      true,
    );
    expect(walletBuyQualifies({ observedAt: at("2026-11-24T10:00:00.000Z"), enrolledAt })).toBe(
      false,
    );
    expect(walletBuyQualifies({ observedAt: at("2026-11-24T12:03:00.000Z"), enrolledAt })).toBe(
      false,
    );
  });

  it("prices the higher fee schedule at -9.5% on a flat $20 and keeps an unresolved exit off zero", () => {
    const high = flatRoundTrip("solana_other");
    expect(high.tokenCashUsd).toBeCloseTo(19.05);
    expect(high.exitCashUsd).toBeCloseTo(18.1);
    expect(high.returnOnAllocated).toBeCloseTo(-0.095);

    expect(allocatedReturn({ kind: "unfilled" })).toBe(0);
    expect(allocatedReturn({ kind: "unresolved" })).toBeNull();
    expect(allocatedReturn({ kind: "filled", exitCashUsd: 18.1 })).toBeCloseTo(-0.095);

    const pairs = pairedDifferences([
      { wallet: 0, control: -0.095 },
      { wallet: null, control: 0.1 },
    ]);
    expect(pairs.mean).toBeCloseTo(0.095);
    expect(pairs.complete).toBe(1);
    expect(pairs.missing).toBe(1);
  });

  it("accepts the first valid exit inside 3 minutes and leaves a later quote unused", () => {
    const entryAt = at("2026-11-24T12:05:00.000Z");
    const onTime = classifyExitObservation({
      entryAt,
      observedAt: at("2026-11-24T13:07:00.000Z"),
      valid: true,
    });
    expect(onTime.usableAsExit).toBe(true);
    expect(onTime.holdMs).toBe(62 * 60 * 1000);
    const late = classifyExitObservation({
      entryAt,
      observedAt: at("2026-11-24T13:09:00.000Z"),
      valid: true,
    });
    expect(late.usableAsExit).toBe(false);
    expect(late.late).toBe(true);
    const diagnostic = classifyExitObservation({
      entryAt,
      observedAt: at("2026-11-24T12:20:00.000Z"),
      valid: true,
    });
    expect(diagnostic.usableAsExit).toBe(false);
  });

  it("matches 1:1, falls back in order, and does not reuse or replace a control", () => {
    const now = at("2026-11-24T12:02:00.000Z");
    const exact = matchOneToOne({
      wallets: [coin("wallet")],
      screened: [coin("same"), coin("other-venue", { venue: "meteora" })],
      now,
    });
    expect(exact.pairs).toEqual([{ wallet: "wallet", control: "same", fallback: "stratum" }]);
    expect(exact.unmatched).toEqual([]);

    const widened = matchOneToOne({
      wallets: [coin("wallet")],
      screened: [
        coin("venue-only", { liquidityUsd: 100_000, minutesSinceGraduation: 25, hourUtc: 1 }),
      ],
      now,
    });
    expect(widened.pairs[0]?.fallback).toBe("venue_only");

    const none = matchOneToOne({
      wallets: [coin("wallet"), coin("second")],
      screened: [coin("only-one")],
      now,
    });
    expect(none.pairs).toHaveLength(1);
    expect(none.unmatched).toEqual(["second"]);

    const benchmark = drawBenchmark({
      coins: [{ mint: "a" }, { mint: "b" }, { mint: "c" }],
      exclude: new Set(["a"]),
      count: 1,
      now,
    });
    expect(benchmark).toHaveLength(1);
    expect(benchmark[0]).not.toBe("a");
  });

  it("bootstraps by day and applies the go rules", () => {
    const interval = blockBootstrapDelta({
      pairs: [
        { day: "2026-11-24", wallet: 0.2, control: 0 },
        { day: "2026-11-24", wallet: 0.2, control: 0 },
      ],
      replicates: 20,
      seed: 1,
    });
    expect(interval.mean).toBeCloseTo(0.2);
    expect(interval.low).toBeCloseTo(0.2);
    expect(interval.high).toBeCloseTo(0.2);

    expect(
      experimentCall({
        deltaLow: 0.06,
        deltaHigh: 0.1,
        walletMean: 0.02,
        walletHigh: 0.04,
        requiredReturn: 0.01,
        gatesPass: true,
        survivesSensitivity: true,
        economicsFail: false,
      }),
    ).toBe("go");
    expect(
      experimentCall({
        deltaLow: 0,
        deltaHigh: 0.04,
        walletMean: 0.02,
        walletHigh: 0.04,
        requiredReturn: 0,
        gatesPass: true,
        survivesSensitivity: true,
        economicsFail: false,
      }),
    ).toBe("no_go");
    expect(
      experimentCall({
        deltaLow: 0.01,
        deltaHigh: 0.08,
        walletMean: 0.02,
        walletHigh: 0.04,
        requiredReturn: 0,
        gatesPass: true,
        survivesSensitivity: true,
        economicsFail: false,
      }),
    ).toBe("inconclusive");

    const scenarios = threeScenarios({ walletMultiple: 1, controlMultiple: 1 });
    expect(scenarios.bothHigh).toBeCloseTo(0);
    expect(scenarios.adverse).toBeLessThan(0);
  });
});
