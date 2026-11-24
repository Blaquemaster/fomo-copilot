import { describe, expect, it } from "vitest";

import {
  buildCandidateLog,
  observationLabel,
  outcomeFromPrices,
  scheduleObservations,
} from "./outcomes.js";
import type { ScreenFacts, ScreenRules } from "./screen.js";
import type { ScoreCoin } from "./score.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  entryImpactPctAbove: 10,
  top10FailAbove: 50,
  sniperFailAbove: 60,
  trenchMinTrackedBuyers: 1,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function coin(
  mint: string,
  overrides: Partial<ScoreCoin & ScreenFacts> = {},
): ScoreCoin & ScreenFacts {
  return {
    mint,
    createdAt: new Date("2026-11-19T16:00:00.000Z"),
    graduatedAt: null,
    curveCompletedAt: null,
    trackedBuyers: 0,
    xMentions: null,
    liquidityUsd: 20_000,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    transferFeeBps: 0,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    top10HoldersPct: 10,
    sniperBundlePct: 1,
    uniqueMakers1h: 80,
    creatorSells: 0,
    quoteError: false,
    ...overrides,
  };
}

describe("candidate log", () => {
  it("records fails, watches, no-wallet trench coins, and pause hypotheticals", () => {
    const now = new Date("2026-11-19T16:30:00.000Z");
    const rows = buildCandidateLog({
      now,
      rules,
      paused: true,
      entries: [],
      prices: new Map([["clean", 0.01]]),
      coins: [
        coin("clean"),
        coin("bad", { mintAuthorityActive: true }),
        coin("wait", { entryQuoteImpactPct: null }),
        coin("backed", { trackedBuyers: 2 }),
      ],
    });
    expect(rows.find((row) => row.mint === "bad")?.group.startsWith("screen_failed:")).toBe(true);
    expect(rows.find((row) => row.mint === "wait")?.verdict).toBe("watch");
    const noWallet = rows.find((row) => row.mint === "clean");
    expect(noWallet?.group).toBe("screen_no_wallet");
    expect(noWallet?.recordedOnly).toBe(true);
    expect(noWallet?.duringPause).toBe(true);
    expect(noWallet?.alertPriceUsd).toBe(0.01);
    const pausedWallet = rows.find((row) => row.mint === "backed");
    expect(pausedWallet?.reason).toBe("during_pause");
    expect(pausedWallet?.recordedOnly).toBe(true);
    expect(rows.some((row) => row.group === "random_unscreened")).toBe(true);
    expect(rows.every((row) => row.outcomeDueAt.getTime() - now.getTime() === 60 * 60 * 1000)).toBe(
      true,
    );
  });

  it("stores a failed one-hour quote as missing and a priced quote as a return", () => {
    const scheduled = scheduleObservations(new Date("2026-11-24T12:00:00.000Z"));
    expect(scheduled.map((row) => row.label)).toEqual(["15m", "30m", "45m", "60m"]);
    expect(scheduled.map((row) => row.role)).toEqual([
      "diagnostic",
      "diagnostic",
      "diagnostic",
      "exit",
    ]);
    expect(
      observationLabel({
        scheduledLabel: "60m",
        dueAt: scheduled[3]?.dueAt ?? new Date(),
        observedAt: new Date("2026-11-24T13:10:00.000Z"),
      }).label,
    ).toBe("late");
    expect(outcomeFromPrices(0.01, null)).toEqual({ status: "missing", priceUsd: null, net: null });
    const priced = outcomeFromPrices(0.01, 0.012);
    expect(priced.status).toBe("priced");
    expect(priced.net).toBeCloseTo(0.2);
  });
});
