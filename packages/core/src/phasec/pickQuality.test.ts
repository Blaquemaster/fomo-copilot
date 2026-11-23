import { describe, expect, it } from "vitest";

import { runPhaseCPass, type PassCoin, type PassInput } from "./pass.js";
import {
  defaultSizePct,
  protocolBody,
  protocolFingerprint,
  type PhaseCConfig,
} from "./protocol.js";
import { assignArm } from "./score.js";
import { screenCoin, shouldFetchSniper, type ScreenFacts, type ScreenRules } from "./screen.js";
import { etDayRange, nextEtMidnight } from "./time.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  top10FailAbove: 50,
  sniperFailAbove: 60,
  trenchMinTrackedBuyers: 1,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function facts(overrides: Partial<ScreenFacts> = {}): ScreenFacts {
  return {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    transferFeeBps: 0,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    top10HoldersPct: 20,
    sniperBundlePct: 0,
    liquidityUsd: 5_000,
    uniqueMakers1h: null,
    creatorSells: 0,
    quoteError: false,
    roundTripCostPct: 1.5,
    ...overrides,
  };
}

function config(): PhaseCConfig {
  return {
    bankroll: 1_000,
    sizePct: defaultSizePct(),
    dailyLossCutoffPct: 3,
    maxConcurrent: 5,
    quietHours: "23:00-07:00",
    quietPostGradMinStrength: 0.7,
    quietPostGradMinSizePct: 2,
    exitStopPct: 25,
    entryDelaySec: 90,
    horizonMs: 60 * 60 * 1000,
    paperWindowDays: 7,
    paperMinAlerts: 100,
    paperMaxDrawdownPct: 15,
    maxPerHour: 6,
    promoteRate: 0.75,
    secondWaveMinChangePct: 20,
    marketPollMinutes: 10,
    xEnabled: false,
    destination: "test",
    fomoFeeSchedule: "solana_lowest_fee",
  };
}

const NOW = new Date("2026-11-22T18:00:00.000Z");

function coin(mint: string, overrides: Partial<PassCoin> = {}): PassCoin {
  return {
    mint,
    createdAt: new Date(NOW.getTime() - 10 * 60_000),
    graduatedAt: null,
    curveCompletedAt: null,
    trackedBuyers: 0,
    xMentions: null,
    liquidityUsd: 5_000,
    transferFeeBps: 0,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    top10HoldersPct: 20,
    sniperBundlePct: 0,
    uniqueMakers1h: null,
    creatorSells: 0,
    quoteError: false,
    roundTripCostPct: 1.5,
    ...overrides,
  };
}

function mintFor(buyers: number, arm: string, salt: string): string {
  for (let index = 0; index < 800; index += 1) {
    const mint = `${salt}${index.toString()}11111111111111111111111111111111`;
    if (assignArm(mint, "trench", buyers) === arm) return mint;
  }
  throw new Error(arm);
}

function pass(overrides: Partial<PassInput> = {}): PassInput {
  const cfg = config();
  return {
    now: NOW,
    config: cfg,
    rules,
    locked: { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg },
    coins: [],
    quotes: [],
    positions: [],
    closedToday: [],
    paused: false,
    resolved: [],
    alerted: [],
    held: [],
    recentEntryCount: 0,
    wallets: [],
    pendingTiers: [],
    registeredAt: new Date("2026-11-22T17:00:00.000Z"),
    ...overrides,
  };
}

describe("pick quality screen", () => {
  it("fails extreme wallet concentration and bundled launches", () => {
    expect(screenCoin(facts({ top10HoldersPct: 51 }), rules).verdict).toBe("fail");
    expect(screenCoin(facts({ sniperBundlePct: 87.5 }), rules).verdict).toBe("fail");
    expect(screenCoin(facts({ sniperBundlePct: 50 }), rules).verdict).toBe("pass");
    expect(screenCoin(facts({ top10HoldersPct: 40 }), rules).warnings).toContain(
      "top 10 holders 40.0%",
    );
    expect(screenCoin(facts(), rules).verdict).toBe("pass");
  });

  it("keeps the old warn-only behavior when the hard limits are unset", () => {
    const loose: ScreenRules = { ...rules, top10FailAbove: undefined, sniperFailAbove: undefined };
    expect(screenCoin(facts({ top10HoldersPct: 100, sniperBundlePct: 90 }), loose).verdict).toBe(
      "pass",
    );
  });

  it("WATCH-blocks an unmeasured sniper on every venue, and still fails a measured bundle", () => {
    const missing = facts({ sniperBundlePct: null });
    expect(screenCoin(missing, rules).verdict).toBe("watch");
    expect(screenCoin(missing, rules).sniperUnmeasured).toBe(true);
    const unmeasured = facts({ sniperBundlePct: null, sniperFetchable: false });
    const blocked = screenCoin(unmeasured, rules);
    expect(blocked.verdict).toBe("watch");
    expect(blocked.sniperUnmeasured).toBe(true);
    expect(blocked.warnings).toContain("sniper unmeasured");
    expect(blocked.warnings).toContain("snipers missing");
    expect(
      screenCoin(facts({ sniperBundlePct: 87.5, sniperFetchable: false }), rules).verdict,
    ).toBe("fail");
    const pending = facts({ sniperBundlePct: null, sniperFetchable: true });
    expect(screenCoin(pending, rules).verdict).toBe("watch");
    expect(screenCoin(pending, rules).sniperUnmeasured).toBe(true);
  });

  it("does not enter a launchlab wallet pick until sniper is measured", () => {
    const backed = mintFor(2, "wallets_x_screen", "LabSniper");
    const result = runPhaseCPass(
      pass({
        coins: [
          coin(backed, {
            trackedBuyers: 2,
            sniperBundlePct: null,
            poolType: "launchlab",
            createdSlot: 100,
            bondingCurve: "LabCurve1111111111111111111111111111111",
          }),
        ],
      }),
    );
    expect(result.entries).toHaveLength(0);
  });

  it("lets a control enter while sniper is unmeasured, and tags the record", () => {
    const control = mintFor(0, "random_pass", "CtrlSniper");
    const result = runPhaseCPass(
      pass({
        coins: [
          coin(control, {
            trackedBuyers: 0,
            sniperBundlePct: null,
            poolType: "dbc",
            createdSlot: null,
            bondingCurve: null,
          }),
        ],
      }),
    );
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.arm).toBe("random_pass");
    expect(result.entries[0]?.sniperUnmeasured).toBe(true);
  });

  it("keeps a fetchable but still-unknown sniper in WATCH", () => {
    const backed = mintFor(2, "wallets_x_screen", "PumpSniper");
    const result = runPhaseCPass(
      pass({
        coins: [
          coin(backed, {
            trackedBuyers: 2,
            sniperBundlePct: null,
            poolType: "pump",
            createdSlot: 100,
            bondingCurve: "PumpCurve111111111111111111111111111111",
          }),
        ],
      }),
    );
    expect(result.entries).toHaveLength(0);
  });

  it("needs a tracked buyer for a trench strategy entry but keeps the control", () => {
    const noWallet = mintFor(0, "screen_only", "Bare");
    const control = mintFor(0, "random_pass", "Ctrl");
    const backed = mintFor(1, "wallets_x_screen", "Back");
    const result = runPhaseCPass(
      pass({
        coins: [coin(noWallet), coin(control), coin(backed, { trackedBuyers: 2 })],
      }),
    );
    const arms = result.entries.map((entry) => `${entry.mint}:${entry.arm}`);
    expect(arms).toContain(`${backed}:wallets_x_screen`);
    expect(arms).toContain(`${control}:random_pass`);
    expect(arms.some((row) => row.startsWith(noWallet))).toBe(false);
  });

  it("does not enter a coin whose wallet top 10 is above the hard limit", () => {
    const backed = mintFor(1, "wallets_x_screen", "Conc");
    const result = runPhaseCPass(
      pass({ coins: [coin(backed, { trackedBuyers: 3, top10HoldersPct: 80 })] }),
    );
    expect(result.entries).toHaveLength(0);
  });

  it("runs the paper window from the first allowed entry", () => {
    const entriesStartAt = new Date("2026-11-23T05:00:00.000Z");
    const result = runPhaseCPass(
      pass({
        now: new Date("2026-11-29T23:00:00.000Z"),
        registeredAt: new Date("2026-11-22T20:00:00.000Z"),
        entriesStartAt,
      }),
    );
    expect(result.paper.status).toBe("collecting");
  });
});

describe("ET day boundaries", () => {
  it("runs midnight to midnight ET", () => {
    const range = etDayRange(new Date("2026-11-22T18:30:00.000Z"));
    expect(range.day).toBe("2026-11-22");
    expect(range.start.toISOString()).toBe("2026-11-22T05:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(nextEtMidnight(new Date("2026-11-22T18:30:00.000Z")).toISOString()).toBe(
      "2026-11-23T05:00:00.000Z",
    );
  });

  it("handles the 25 hour day when DST ends and late-evening ET", () => {
    const fallBack = etDayRange(new Date("2026-11-01T15:00:00.000Z"));
    expect(fallBack.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    const late = etDayRange(new Date("2026-11-23T04:30:00.000Z"));
    expect(late.day).toBe("2026-11-22");
    expect(late.start.toISOString()).toBe("2026-11-22T05:00:00.000Z");
    const spring = etDayRange(new Date("2026-03-08T15:00:00.000Z"));
    expect(spring.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

describe("sniper fetch budget", () => {
  const ready = {
    trackedBuyers: 0,
    createdSlot: 10,
    bondingCurve: "Curve111111111111111111111111111111111",
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    top10HoldersPct: 20,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    sniperBundlePct: null,
  };

  it("fetches a coin that already passed cheaper gates", () => {
    expect(shouldFetchSniper(ready, rules)).toBe(true);
  });

  it("fetches a wallet-signal coin even if cheaper facts are still missing", () => {
    expect(
      shouldFetchSniper(
        { ...ready, trackedBuyers: 2, mintAuthorityActive: null, top10HoldersPct: null },
        rules,
      ),
    ).toBe(true);
  });

  it("skips coins that failed a cheaper gate or have no origin", () => {
    expect(shouldFetchSniper({ ...ready, top10HoldersPct: 80 }, rules)).toBe(false);
    expect(shouldFetchSniper({ ...ready, bondingCurve: null, trackedBuyers: 3 }, rules)).toBe(
      false,
    );
    expect(shouldFetchSniper({ ...ready, mintAuthorityActive: null }, rules)).toBe(false);
    expect(shouldFetchSniper({ ...ready, sniperBundlePct: 5 }, rules)).toBe(false);
  });
});
