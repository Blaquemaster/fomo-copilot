import { describe, expect, it, vi } from "vitest";

import {
  assignExitTreatment,
  defaultSizePct,
  jupiterQuoteUrl,
  mihaoObservation,
  parseJupiterQuote,
  protocolBody,
  protocolFingerprint,
  quoteKey,
  quoteUrlAllowed,
  runPhaseCPass,
  secondWaveSignal,
  SOL_MINT,
  type PassCoin,
  type PassPosition,
  type PhaseCConfig,
  type ScreenRules,
} from "@fomo/core";

import {
  curveLiquidityUsd,
  parseLaunchLabCurve,
  parseMeteoraCurve,
  parseVenueCurve,
  parseMintAccount,
  parsePumpCurve,
  screenCreditProjection,
  topHolderPct,
} from "./accounts.js";
import { collectJupiterBids } from "./jupiter.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function config(): PhaseCConfig {
  return {
    bankroll: 10_000,
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

function readyCoin(mint: string): PassCoin {
  return {
    mint,
    createdAt: new Date("2026-11-19T12:00:00.000Z"),
    graduatedAt: null,
    curveCompletedAt: null,
    trackedBuyers: 0,
    xMentions: null,
    liquidityUsd: 20_000,
    transferFeeBps: 0,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    top10HoldersPct: 10,
    sniperBundlePct: 4,
    uniqueMakers1h: 80,
    creatorSells: 0,
    trackedSells: 0,
    quoteError: false,
    secondWave: null,
    roundTripCostPct: 1.5,
  };
}

describe("quoted paper path", () => {
  it("takes a coin from alert through a Jupiter entry, a scale-out, and a quoted exit", async () => {
    let mint = "Paper111111111111111111111111111111111111";
    for (let index = 0; index < 50; index += 1) {
      const candidate = `Paper${index.toString()}11111111111111111111111111111111`;
      if (assignExitTreatment(candidate) === "scale_out") {
        mint = candidate;
        break;
      }
    }
    const cfg = config();
    const now = new Date("2026-11-19T16:30:00.000Z");
    const locked = { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg };
    const alerted = runPhaseCPass({
      now,
      config: cfg,
      rules,
      locked,
      coins: [readyCoin(mint)],
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
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(alerted.entries).toHaveLength(1);
    expect(alerted.entries[0]?.text).toContain("screen: pass");
    expect(alerted.entries[0]?.text).toContain("scale out half");
    const buy = await collectJupiterBids({
      requests: [
        {
          mint,
          side: "buy",
          amount: "333333333",
          purpose: "entry",
          which: "1x",
          priority: 1,
          sizeUsd: 50,
          solPriceUsd: 150,
        },
        {
          mint,
          side: "buy",
          amount: "666666666",
          purpose: "entry",
          which: "2x",
          priority: 1,
          sizeUsd: 100,
          solPriceUsd: 150,
        },
      ],
      nowMs: now.getTime(),
      sleep: async () => undefined,
      fetchImpl: vi.fn(async (url: string) => {
        expect(quoteUrlAllowed(url)).toBe(true);
        expect(url.startsWith(jupiterQuoteUrl(SOL_MINT, mint, "333333333").slice(0, 40))).toBe(
          true,
        );
        const amount = new URL(url).searchParams.get("amount");
        return {
          status: 200,
          json: async () => ({
            inAmount: amount,
            outAmount: amount === "666666666" ? "1800000" : "1000000",
            priceImpactPct: "0.01",
            routePlan: [{ swapInfo: { feeAmount: "1000" } }],
          }),
        };
      }) as unknown as typeof fetch,
    });
    expect(buy.bids[quoteKey(mint, "entry", "1x")]?.ok).toBe(true);
    const opened = runPhaseCPass({
      now: new Date("2026-11-19T16:31:30.000Z"),
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: {
        [quoteKey(mint, "entry", "1x")]: buy.bids[quoteKey(mint, "entry", "1x")] ?? {
          ok: false,
          reason: "no_quote",
        },
        [quoteKey(mint, "entry", "2x")]: buy.bids[quoteKey(mint, "entry", "2x")] ?? {
          ok: false,
          reason: "no_quote",
        },
      },
      positions: [
        {
          id: "pos-1",
          mint,
          stage: "trench",
          arm: alerted.entries[0]?.arm ?? "screen_only",
          status: "pending",
          alertAt: now,
          entryAfter: new Date("2026-11-19T16:31:30.000Z"),
          openedAt: null,
          entryQuote: null,
          sizePct: 0.5,
          exitPlan: alerted.entries[0]?.exitPlan ?? "",
          screenFailed: false,
        },
      ],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [{ mint, stage: "trench" }],
      held: [],
      recentEntryCount: 1,
      wallets: [],
      pendingTiers: [],
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(opened.opens[0]?.outAmount).toBe("1000000");
    expect(opened.opens[0]?.impactPct).toBeCloseTo(1);
    const position: PassPosition = {
      id: "pos-1",
      mint,
      stage: "trench",
      arm: "screen_only",
      status: "open",
      alertAt: now,
      entryAfter: new Date("2026-11-19T16:31:30.000Z"),
      openedAt: new Date("2026-11-19T16:31:30.000Z"),
      entryQuote: opened.opens[0]?.quote ?? 0,
      entryOutAmount: opened.opens[0]?.outAmount,
      entrySizeUsd: 50,
      entryFeeUsd: opened.opens[0]?.feeUsd,
      sizePct: 0.5,
      exitPlan: "scale out",
      screenFailed: false,
    };
    const sellBody = parseJupiterQuote(
      {
        inAmount: "500000",
        outAmount: "260000000",
        priceImpactPct: "0.02",
        routePlan: [{ swapInfo: { feeAmount: "500" } }],
      },
      { sizeUsd: 25, side: "sell", solPriceUsd: 150 },
    );
    const scaled = runPhaseCPass({
      now: new Date("2026-11-19T16:40:00.000Z"),
      config: cfg,
      rules,
      locked,
      coins: [],
      quotes: [],
      bids: {
        [quoteKey(mint, "exit", "1x")]: sellBody,
        [quoteKey(mint, "exit", "2x")]: sellBody,
      },
      positions: [position],
      closedToday: [],
      paused: false,
      resolved: [],
      alerted: [{ mint, stage: "trench" }],
      held: [],
      recentEntryCount: 1,
      wallets: [],
      pendingTiers: [],
      registeredAt: now,
      entriesStartAt: now,
    });
    expect(scaled.immediate.some((line) => line.startsWith("scale-out"))).toBe(true);
    const mintBytes = new Uint8Array(82);
    mintBytes[46] = 1;
    expect(parseMintAccount(mintBytes)?.freezeAuthorityActive).toBe(true);
    expect(parseMintAccount(mintBytes)?.mintAuthorityActive).toBe(false);
    expect(topHolderPct([10, 5], 100)).toBe(15);
    expect(screenCreditProjection(10).perMonth).toBe(10 * 6 * 30);
    const curve = new Uint8Array(49);
    const virtual = 30_000_000_000n;
    const real = 5_000_000_000n;
    for (let index = 0; index < 8; index += 1) {
      curve[16 + index] = Number((virtual >> BigInt(8 * index)) & 0xffn);
      curve[32 + index] = Number((real >> BigInt(8 * index)) & 0xffn);
    }
    const reserves = parsePumpCurve(curve);
    expect(reserves?.virtualSolLamports).toBe(virtual);
    expect(
      curveLiquidityUsd(reserves ?? { virtualSolLamports: 0n, realSolLamports: 0n }, 100),
    ).toBe(3000);
    const launch = new Uint8Array(64);
    const meteora = new Uint8Array(260);
    for (let index = 0; index < 8; index += 1) {
      launch[37 + index] = Number((1_000_000_000n >> BigInt(8 * index)) & 0xffn);
      launch[45 + index] = Number((2_000_000_000n >> BigInt(8 * index)) & 0xffn);
      meteora[232 + index] = Number((4_000_000_000n >> BigInt(8 * index)) & 0xffn);
      meteora[240 + index] = Number((8_000_000_000n >> BigInt(8 * index)) & 0xffn);
    }
    expect(parseLaunchLabCurve(launch)?.virtualSolLamports).toBe(2_000_000_000n);
    expect(parseMeteoraCurve(meteora)?.virtualTokenRaw).toBe(4_000_000_000n);
    expect(parseMeteoraCurve(meteora)?.virtualSolLamports).toBe(8_000_000_000n);
    const liveLaunch = new Uint8Array(429);
    for (let index = 0; index < 8; index += 1) {
      liveLaunch[37 + index] = Number((1_073_000_000_000_000n >> BigInt(8 * index)) & 0xffn);
      liveLaunch[45 + index] = Number((9_950_000_000n >> BigInt(8 * index)) & 0xffn);
      liveLaunch[232 + index] = 1;
      liveLaunch[240 + index] = 2;
    }
    expect(parseLaunchLabCurve(liveLaunch)?.virtualSolLamports).toBe(9_950_000_000n);
    expect(parseMeteoraCurve(liveLaunch)?.virtualSolLamports).not.toBe(9_950_000_000n);
    expect(parseVenueCurve(liveLaunch, "launchlab")?.venue).toBe("launchlab");
    expect(parseVenueCurve(meteora, "meteora")?.virtualSolLamports).toBe(8_000_000_000n);
    const nowWave = new Date("2026-11-19T16:30:00.000Z");
    expect(secondWaveSignal(mihaoObservation(nowWave), nowWave)).toBe("breakout");
    expect(quoteUrlAllowed("https://api.jup.ag/swap")).toBe(false);
    expect(quoteUrlAllowed("https://api.jup.ag/swap/v1/swap-instructions")).toBe(false);
    expect(quoteUrlAllowed("https://api.jup.ag/execute")).toBe(false);
  });
});
