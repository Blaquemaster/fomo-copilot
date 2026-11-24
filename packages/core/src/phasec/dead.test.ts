import { describe, expect, it } from "vitest";

import { classifyJupiterHttp } from "./quote.js";
import { runPhaseCPass, type PassPosition } from "./pass.js";
import { quoteKey } from "./quote.js";
import {
  DRAINED_SOL_LAMPORTS,
  nextNoRouteStreak,
  shouldBookDead,
  tradabilityFromReserves,
} from "./dead.js";
import { protocolBody, protocolFingerprint, type PhaseCConfig } from "./protocol.js";
import type { ScreenRules } from "./screen.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  top10FailAbove: 50,
  sniperFailAbove: 60,
  trenchMinTrackedBuyers: 1,
  walletMaxMintsPerDay: 40,
  walletBuyFreshMinutes: 60,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function config(): PhaseCConfig {
  return {
    bankroll: 1000,
    sizePct: { trench: 0.5, near_graduation: 1, post_graduation: 2, second_wave: 1 },
    dailyLossCutoffPct: 3,
    maxConcurrent: 5,
    quietHours: "off",
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
    deadNoRouteStreak: 3,
    deadNoRouteGapMs: 60_000,
  };
}

function position(now: Date, overrides: Partial<PassPosition> = {}): PassPosition {
  return {
    id: "dead-1",
    mint: "DeadMint111111111111111111111111111111111",
    stage: "trench",
    arm: "screen_only",
    status: "open",
    alertAt: now,
    entryAfter: now,
    openedAt: now,
    entryQuote: 1,
    entrySizeUsd: 10,
    entryFeeUsd: 0,
    sizePct: 0.5,
    exitPlan: "stop",
    screenFailed: false,
    ...overrides,
  };
}

function noRoute(status = 200, body = '{"error":"No route found"}') {
  return {
    ok: false as const,
    reason: "no_route" as const,
    httpStatus: status,
    errorBody: body,
  };
}

describe("dead and unpriced quotes", () => {
  it("classifies HTTP 400, 404, 429 and 5xx apart from a true no-route", () => {
    expect(classifyJupiterHttp(400)).toBe("http_400");
    expect(classifyJupiterHttp(404)).toBe("http_404");
    expect(classifyJupiterHttp(429)).toBe("rate_limited");
    expect(classifyJupiterHttp(500)).toBe("transient");
    expect(classifyJupiterHttp(418)).toBe("api_error");
    expect(classifyJupiterHttp(200)).toBe("ok");
  });

  it("does not book a dead loss from one no-route, then keeps the position open on a later quote", () => {
    const cfg = config();
    const now = new Date("2026-11-19T16:40:00.000Z");
    const locked = { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg };
    const mint = position(now).mint;
    const first = runPhaseCPass({
      now,
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: { [quoteKey(mint, "exit", "1x")]: noRoute() },
      poolState: { [mint]: "drained" },
      positions: [position(now)],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [],
      held: [],
      recentEntryCount: 0,
      wallets: [],
      pendingTiers: [],
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(first.closes).toEqual([]);
    expect(first.streaks.at(-1)?.streak).toBe(1);
    expect(first.quoteFailures[0]?.httpStatus).toBe(200);
    expect(first.quoteFailures[0]?.body).toContain("No route");
    const later = new Date(now.getTime() + 60_000);
    const second = runPhaseCPass({
      now: later,
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: {
        [quoteKey(mint, "exit", "1x")]: {
          ok: true,
          execPriceUsd: 0.9,
          midPriceUsd: 0.9,
          impactPct: 1,
          feeUsd: 0,
          sizeUsd: 10,
          liquidityUsd: 1000,
          inAmount: "1",
          outAmount: "1",
        },
      },
      positions: [
        position(now, {
          noRouteStreak: 1,
          noRouteFirstAt: now,
          noRouteLastAt: now,
        }),
      ],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [],
      held: [],
      recentEntryCount: 0,
      wallets: [],
      pendingTiers: [],
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(second.closes).toEqual([]);
    expect(second.streaks.at(-1)?.streak).toBe(0);
  });

  it("books -100% only after three spaced no-routes and a drained pool", () => {
    const cfg = config();
    const opened = new Date("2026-11-19T16:00:00.000Z");
    const now = new Date("2026-11-19T16:03:00.000Z");
    const locked = { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg };
    const mint = position(opened).mint;
    const base = {
      now,
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: { [quoteKey(mint, "exit", "1x")]: noRoute(200, "no route") },
      positions: [
        position(opened, {
          noRouteStreak: 2,
          noRouteFirstAt: new Date(now.getTime() - 180_000),
          noRouteLastAt: new Date(now.getTime() - 60_000),
        }),
      ],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [],
      held: [],
      recentEntryCount: 0,
      wallets: [],
      pendingTiers: [],
      registeredAt: opened,
      entriesStartAt: opened,
    };
    const intact = runPhaseCPass({ ...base, poolState: { [mint]: "tradable" } });
    expect(intact.closes).toEqual([]);
    expect(intact.streaks.at(-1)?.streak).toBe(3);
    const drained = runPhaseCPass({ ...base, poolState: { [mint]: "drained" } });
    expect(drained.closes[0]?.reason).toBe("dead");
    expect(drained.closes[0]?.net).toBe(-1);
    const horizon = new Date(opened.getTime() + cfg.horizonMs);
    const unpriced = runPhaseCPass({
      ...base,
      now: horizon,
      poolState: { [mint]: "tradable" },
    });
    expect(unpriced.closes[0]?.reason).toBe("unpriced");
    expect(unpriced.closes[0]?.net).toBe(-1);
    expect(unpriced.paper.alerts).toBe(1);
    expect(unpriced.paper.medianNet).toBe(-1);
  });

  it("stores an HTTP 400 body and does not treat it as a no-route", () => {
    const cfg = config();
    const now = new Date("2026-11-19T16:40:00.000Z");
    const locked = { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg };
    const mint = position(now).mint;
    const result = runPhaseCPass({
      now,
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: {
        [quoteKey(mint, "exit", "1x")]: {
          ok: false,
          reason: "http_400",
          httpStatus: 400,
          errorBody: "Cannot compute route",
        },
      },
      poolState: { [mint]: "drained" },
      positions: [
        position(now, {
          noRouteStreak: 2,
          noRouteFirstAt: new Date(now.getTime() - 180_000),
          noRouteLastAt: new Date(now.getTime() - 60_000),
        }),
      ],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [],
      held: [],
      recentEntryCount: 0,
      wallets: [],
      pendingTiers: [],
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(result.closes).toEqual([]);
    expect(result.quoteFailures[0]).toMatchObject({
      httpStatus: 400,
      reason: "http_400",
      body: "Cannot compute route",
    });
    expect(result.streaks.at(-1)?.streak).toBe(0);
  });

  it("reads a direct pool as closed, drained, or still tradable", () => {
    expect(
      tradabilityFromReserves({
        exists: false,
        virtualSolLamports: null,
        virtualTokenRaw: null,
        sellAmountRaw: 1n,
      }),
    ).toBe("closed");
    expect(
      tradabilityFromReserves({
        exists: true,
        virtualSolLamports: DRAINED_SOL_LAMPORTS,
        virtualTokenRaw: 1_000n,
        sellAmountRaw: 1n,
      }),
    ).toBe("drained");
    expect(
      tradabilityFromReserves({
        exists: true,
        virtualSolLamports: 30_000_000_000n,
        virtualTokenRaw: 1_000_000_000_000n,
        sellAmountRaw: 10_000n,
      }),
    ).toBe("tradable");
    expect(
      nextNoRouteStreak({
        previous: { streak: 1, firstAt: new Date(0), lastAt: new Date(0) },
        now: new Date(30_000),
        gapMs: 60_000,
        event: "no_route",
      }).streak,
    ).toBe(1);
    expect(
      shouldBookDead({
        streak: { streak: 3, firstAt: new Date(0), lastAt: new Date(120_000) },
        now: new Date(120_000),
        requiredStreak: 3,
        gapMs: 60_000,
        pool: "no_direct_route",
      }),
    ).toBe(true);
    expect(
      shouldBookDead({
        streak: { streak: 3, firstAt: new Date(0), lastAt: new Date(120_000) },
        now: new Date(120_000),
        requiredStreak: 3,
        gapMs: 60_000,
        pool: "unknown",
      }),
    ).toBe(false);
  });
});
