import { describe, expect, it } from "vitest";

import { formatWeeklyReview, quietHold, resolveAlertChat } from "./deliver.js";
import { planExit } from "./exit.js";
import {
  GECKO_REQUESTS_PER_MIN,
  dexScreenerTokenUrl,
  geckoTerminalTokenUrl,
  mihaoFixtureQuote,
  parseDexScreener,
  parseGeckoTerminal,
  quoteUrlAllowed,
  takeTokens,
} from "./market.js";
import { bankrollCurve, evaluatePaper, powerSampleSize } from "./paper.js";
import { runPhaseCPass, type PassCoin, type PassInput } from "./pass.js";
import {
  defaultSizePct,
  mintBucket,
  parseLockedConfig,
  protocolBody,
  protocolFingerprint,
  type PhaseCConfig,
} from "./protocol.js";
import { entryDecision, planTierPromotions, sizeForArmStage } from "./risk.js";
import { lookupTradableInFomo } from "./fomoLookup.js";
import { assignArm, isFlapMint, scoreStrength } from "./score.js";
import {
  fomoFeeUsd,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  liquidityFromSellImpact,
  curveFallbackBid,
  modeledSellQuote,
  parseJupiterQuote,
  quoteKey,
  quotedRoundTrip,
  roundTripCostPct,
} from "./quote.js";
import { screenCoin, type ScreenRules } from "./screen.js";
import {
  deadCoinObservation,
  mihaoObservation,
  secondWaveSignal,
  tooYoungObservation,
} from "./secondWave.js";
import { inQuietHours } from "./time.js";

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

function config(overrides: Partial<PhaseCConfig> = {}): PhaseCConfig {
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
    ...overrides,
  };
}

function coin(mint: string, overrides: Partial<PassCoin> = {}): PassCoin {
  return {
    mint,
    createdAt: new Date("2026-11-19T16:00:00.000Z"),
    graduatedAt: null,
    curveCompletedAt: null,
    trackedBuyers: 0,
    xMentions: null,
    liquidityUsd: 20_000,
    transferFeeBps: 0,
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    exitQuoteImpactPct: 1,
    top10HoldersPct: 10,
    sniperBundlePct: 5,
    uniqueMakers1h: 80,
    creatorSells: 0,
    quoteError: false,
    roundTripCostPct: 1.5,
    ...overrides,
  };
}

function mintFor(
  stage: "trench" | "post_graduation",
  buyers: number,
  arm: string,
  salt: string,
): string {
  for (let index = 0; index < 800; index += 1) {
    const mint = `${salt}${index.toString()}11111111111111111111111111111111`;
    if (assignArm(mint, stage, buyers) === arm) return mint;
  }
  throw new Error(arm);
}

function pass(overrides: Partial<PassInput> = {}): PassInput {
  const cfg = overrides.config ?? config();
  return {
    now: new Date("2026-11-19T16:30:00.000Z"),
    config: cfg,
    rules,
    locked:
      overrides.locked === undefined
        ? { fingerprint: protocolFingerprint(protocolBody(cfg, rules)), config: cfg }
        : overrides.locked,
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
    registeredAt: new Date("2026-11-19T16:30:00.000Z"),
    ...overrides,
  };
}

describe("phase C", () => {
  it("keeps quiet hours at 11pm to 7am ET and lets a strong post-graduation through", () => {
    expect(inQuietHours(new Date("2026-11-19T04:00:00.000Z"), "23:00-07:00")).toBe(true);
    expect(inQuietHours(new Date("2026-11-19T11:59:00.000Z"), "23:00-07:00")).toBe(true);
    expect(inQuietHours(new Date("2026-11-19T12:00:00.000Z"), "23:00-07:00")).toBe(false);
    const mint = mintFor("post_graduation", 1, "wallets_x_screen", "Post");
    const result = runPhaseCPass(
      pass({
        now: new Date("2026-11-19T04:30:00.000Z"),
        coins: [
          coin(mint, {
            trackedBuyers: 1,
            graduatedAt: new Date("2026-11-19T04:20:00.000Z"),
            createdAt: new Date("2026-11-19T03:00:00.000Z"),
          }),
          coin(mintFor("trench", 0, "screen_only", "Trench"), {
            createdAt: new Date("2026-11-19T04:00:00.000Z"),
          }),
        ],
      }),
    );
    const post = result.entries.find((entry) => entry.stage === "post_graduation");
    const trench = result.entries.find((entry) => entry.stage === "trench");
    expect(post?.held).toBe(false);
    expect(post?.text).toContain("size 2% ($200.00 of $10000.00)");
    expect(trench?.held).toBe(true);
    expect(result.immediate.some((line) => line.startsWith("trench"))).toBe(false);
  });

  it("scores without X, screens hard failures, and charges the quoted round trip", () => {
    const plain = coin("plain");
    expect(scoreStrength("trench", plain)).toBe(
      scoreStrength("trench", { ...plain, xMentions: null }),
    );
    expect(scoreStrength("trench", { ...plain, xMentions: 2 })).toBeGreaterThan(
      scoreStrength("trench", plain),
    );
    expect(screenCoin({ ...plain, mintAuthorityActive: true }, rules).verdict).toBe("fail");
    expect(screenCoin({ ...plain, quoteError: true }, rules).verdict).toBe("watch");
    expect(screenCoin({ ...plain, mintAuthorityActive: null }, rules).verdict).toBe("watch");
    expect(screenCoin({ ...plain, liquidityUsd: null }, rules).verdict).toBe("watch");
    expect(screenCoin({ ...plain, sniperBundlePct: null }, rules).verdict).toBe("watch");
    expect(
      entryDecision({
        openCount: 0,
        maxConcurrent: 5,
        mintBusy: false,
        exitPlan: "",
        paused: false,
      }),
    ).toEqual({
      ok: false,
      reason: "exit_plan",
    });
    expect(
      entryDecision({
        openCount: 5,
        maxConcurrent: 5,
        mintBusy: false,
        exitPlan: "stop",
        paused: false,
      }),
    ).toEqual({
      ok: false,
      reason: "concurrent",
    });
    expect(
      entryDecision({
        openCount: 1,
        maxConcurrent: 5,
        mintBusy: true,
        exitPlan: "stop",
        paused: false,
      }),
    ).toEqual({
      ok: false,
      reason: "averaging_down",
    });
  });

  it("opens a paper entry 90 seconds after the alert and exits on the quote", () => {
    const mint = mintFor("trench", 0, "screen_only", "Entry");
    const opened = runPhaseCPass(
      pass({
        coins: [coin(mint)],
        quotes: [
          {
            mint,
            priceUsd: 1,
            liquidityUsd: 20_000,
            volumeUsd1h: 1,
            volumeUsd6h: null,
            volumeUsd24h: null,
            priceChange1hPct: 1,
            source: "fixture",
          },
        ],
      }),
    );
    expect(opened.entries[0]?.entryAfter.getTime()).toBe(
      opened.entries[0] ? Date.parse("2026-11-19T16:31:30.000Z") : 0,
    );
    const later = runPhaseCPass(
      pass({
        now: new Date("2026-11-19T17:32:00.000Z"),
        quotes: [
          {
            mint,
            priceUsd: 0.7,
            liquidityUsd: 20_000,
            volumeUsd1h: 1,
            volumeUsd6h: null,
            volumeUsd24h: null,
            priceChange1hPct: -30,
            source: "fixture",
          },
        ],
        positions: [
          {
            id: "p1",
            mint,
            stage: "trench",
            arm: "screen_only",
            status: "open",
            alertAt: new Date("2026-11-19T16:30:00.000Z"),
            entryAfter: new Date("2026-11-19T16:31:30.000Z"),
            openedAt: new Date("2026-11-19T16:31:30.000Z"),
            entryQuote: 1,
            sizePct: 0.5,
            exitPlan: "quote-only",
            screenFailed: false,
          },
        ],
        alerted: [{ mint, stage: "trench" }],
        bids: {
          [quoteKey(mint, "exit", "1x")]: {
            ok: true,
            execPriceUsd: 0.7,
            midPriceUsd: 0.72,
            impactPct: 2.8,
            feeUsd: 0.05,
            sizeUsd: 50,
            liquidityUsd: 20_000,
            inAmount: "1000000000",
            outAmount: "90000000",
          },
          [quoteKey(mint, "exit", "2x")]: {
            ok: true,
            execPriceUsd: 0.65,
            midPriceUsd: 0.72,
            impactPct: 4,
            feeUsd: 0.1,
            sizeUsd: 100,
            liquidityUsd: 20_000,
            inAmount: "2000000000",
            outAmount: "170000000",
          },
        },
      }),
    );
    expect(later.closes[0]?.reason).toBe("stop");
    expect(later.immediate[0]).toContain("exit stop");
    expect(
      planExit({
        openedAt: new Date("2026-11-19T16:31:30.000Z"),
        now: new Date("2026-11-19T17:32:00.000Z"),
        entryQuote: 1,
        latestQuote: 1.1,
        stopPct: 25,
        horizonMs: 60 * 60 * 1000,
        screenFailed: false,
      }).exit,
    ).toBe(true);
  });

  it("pauses at a 3% bankroll loss, refuses a sixth position, and queues a higher tier", () => {
    const busy = Array.from({ length: 5 }, (_unused, index) => ({
      id: `open-${index.toString()}`,
      mint: `open-${index.toString()}`,
      stage: "trench" as const,
      arm: "screen_only" as const,
      status: "open" as const,
      alertAt: new Date("2026-11-19T16:00:00.000Z"),
      entryAfter: new Date("2026-11-19T16:01:30.000Z"),
      openedAt: new Date("2026-11-19T16:01:30.000Z"),
      entryQuote: 1,
      sizePct: 0.5,
      exitPlan: "quote-only",
      screenFailed: false,
    }));
    const blocked = runPhaseCPass(
      pass({ coins: [coin(mintFor("trench", 0, "screen_only", "Busy"))], positions: busy }),
    );
    expect(blocked.entries).toEqual([]);
    const paused = runPhaseCPass(
      pass({
        closedToday: [{ sizePct: 2, netReturn: -1.6 }],
        coins: [coin(mintFor("trench", 0, "screen_only", "Loss"))],
      }),
    );
    expect(paused.pauseReason).toContain("3.");
    expect(paused.entries).toEqual([]);
    expect(
      planTierPromotions([{ address: "wallet", hitRate: 0.8, tier: "base" }], 0.75, new Set()),
    ).toEqual([{ wallet: "wallet", from: "base", to: "high" }]);
    expect(
      planTierPromotions([{ address: "wallet", hitRate: 0.8, tier: "high" }], 0.75, new Set()),
    ).toEqual([]);
  });

  it("sizes screen_only at 0.5% every stage and keeps wallet-backed and control stage sizes", () => {
    const sizes = defaultSizePct();
    const screenPost = sizeForArmStage("post_graduation", "screen_only", sizes, 1000, {
      trackedBuyers: 0,
    });
    expect(screenPost.pct).toBe(0.5);
    expect(screenPost.amount).toBe(5);
    const screenTrench = sizeForArmStage("trench", "screen_only", sizes, 1000, {
      trackedBuyers: 0,
    });
    expect(screenTrench.pct).toBe(0.5);
    const walletPost = sizeForArmStage("post_graduation", "wallets_x_screen", sizes, 1000, {
      trackedBuyers: 2,
    });
    expect(walletPost.pct).toBe(2);
    expect(walletPost.amount).toBe(20);
    const controlPost = sizeForArmStage("post_graduation", "random_pass", sizes, 1000, {
      trackedBuyers: 0,
    });
    expect(controlPost.pct).toBe(2);
  });

  it("hard-fails a coin when the quoted round-trip cost is above 3%", () => {
    const failed = screenCoin(
      {
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
        transferFeeBps: 0,
        exitQuoteImpactPct: 1,
        top10HoldersPct: 10,
        sniperBundlePct: 5,
        liquidityUsd: 20_000,
        uniqueMakers1h: 80,
        creatorSells: 0,
        quoteError: false,
        roundTripCostPct: 4.01,
      },
      { ...rules, maxRoundTripCostPct: 3 },
    );
    expect(failed.verdict).toBe("fail");
    expect(failed.hard.some((item) => item.includes("round-trip cost 4.01%"))).toBe(true);
    const mint = mintFor("post_graduation", 0, "screen_only", "CheapSize");
    const result = runPhaseCPass(
      pass({
        now: new Date("2026-11-19T16:30:00.000Z"),
        coins: [
          coin(mint, {
            trackedBuyers: 0,
            graduatedAt: new Date("2026-11-19T16:10:00.000Z"),
            createdAt: new Date("2026-11-19T15:00:00.000Z"),
            roundTripCostPct: 1.5,
          }),
        ],
      }),
    );
    const entry = result.entries.find((row) => row.mint === mint);
    expect(entry?.arm).toBe("screen_only");
    expect(entry?.sizePct).toBe(0.5);
    const entryBid = {
      ok: true as const,
      execPriceUsd: 1,
      midPriceUsd: 1,
      impactPct: 0,
      feeUsd: 0,
      sizeUsd: 5,
      liquidityUsd: 20_000,
      inAmount: "1",
      outAmount: "5",
    };
    const exitBid = {
      ok: true as const,
      execPriceUsd: 1,
      midPriceUsd: 1,
      impactPct: 0,
      feeUsd: 0,
      sizeUsd: 5,
      liquidityUsd: 20_000,
      inAmount: "5",
      outAmount: "1",
    };
    // $5 notional, lowest-fee schedule: $0.10 + $0.10 FOMO fees = 4% with no impact.
    expect(roundTripCostPct(entryBid, exitBid, "solana_lowest_fee")).toBeCloseTo(4, 8);
  });

  it("pre-registers the paper rule and extends until 100 measured alerts", () => {
    const early = evaluatePaper({
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
      now: new Date("2026-11-03T00:00:00.000Z"),
      windowDays: 7,
      minAlerts: 100,
      maxDrawdownPct: 15,
      returns: [
        { at: new Date("2026-11-02T00:00:00.000Z"), arm: "screen_only", net: 0.01, sizePct: 2 },
      ],
    });
    expect(early.status).toBe("collecting");
    const extended = evaluatePaper({
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
      now: new Date("2026-11-10T00:00:00.000Z"),
      windowDays: 7,
      minAlerts: 100,
      maxDrawdownPct: 15,
      returns: [
        { at: new Date("2026-11-02T00:00:00.000Z"), arm: "screen_only", net: 0.01, sizePct: 2 },
      ],
    });
    expect(extended.status).toBe("extend");
    const sample = Array.from({ length: 100 }, (_unused, index) => ({
      at: new Date(Date.UTC(2026, 10, 2, 0, index)),
      arm: "screen_only" as const,
      net: 0.01,
      sizePct: 2,
    }));
    const go = evaluatePaper({
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
      now: new Date("2026-11-03T00:00:00.000Z"),
      windowDays: 7,
      minAlerts: 100,
      maxDrawdownPct: 15,
      returns: sample,
    });
    expect(go.status).toBe("go");
    expect(go.weeks.some((week) => week.arm === "screen_only" && week.n === 100)).toBe(true);
    const lost = evaluatePaper({
      ...{
        registeredAt: new Date("2026-11-01T00:00:00.000Z"),
        now: new Date("2026-11-03T00:00:00.000Z"),
        windowDays: 7,
        minAlerts: 100,
        maxDrawdownPct: 15,
        returns: sample.map((row) => ({ ...row, net: -0.01 })),
      },
    });
    expect(lost.status).toBe("no_go");
    const first = config();
    const changed = config({ paperMinAlerts: 50 });
    expect(protocolFingerprint(protocolBody(first, rules))).not.toBe(
      protocolFingerprint(protocolBody(changed, rules)),
    );
    const locked = runPhaseCPass(
      pass({
        config: changed,
        locked: { fingerprint: protocolFingerprint(protocolBody(first, rules)), config: first },
      }),
    );
    expect(locked.restart).toBe(true);
    expect(locked.entries).toEqual([]);
    expect(locked.lock?.fingerprint).toBe(protocolFingerprint(protocolBody(changed, rules)));
    expect(locked.config.paperMinAlerts).toBe(50);
  });

  it("reads the mihao fixture as a second wave and refuses swap or execute urls", () => {
    const quote = mihaoFixtureQuote();
    expect(quote.priceChange1hPct).toBe(40);
    expect(parseDexScreener({ pairs: [] })).toEqual([]);
    expect(
      parseGeckoTerminal({ data: { attributes: { address: quote.mint, price_usd: "0.0042" } } })
        ?.priceUsd,
    ).toBe(0.0042);
    const now = new Date("2026-11-19T16:30:00.000Z");
    expect(secondWaveSignal(mihaoObservation(now), now)).toBe("breakout");
    expect(secondWaveSignal(deadCoinObservation(now), now)).toBe("dead");
    expect(secondWaveSignal(tooYoungObservation(now), now)).toBe("too_young");
    const observed = mihaoObservation(now);
    const result = runPhaseCPass(
      pass({
        now,
        coins: [
          coin(observed.mint, {
            graduatedAt: observed.graduatedAt,
            createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000),
            secondWave: "breakout",
            trackedBuyers: 2,
          }),
        ],
      }),
    );
    expect(result.entries[0]?.stage).toBe("second_wave");
    expect(
      result.entries[0]?.arm === "second_wave_a" || result.entries[0]?.arm === "second_wave_b",
    ).toBe(true);
    expect(result.entries[0]?.sizePct).toBe(1);
    expect(result.entries[0]?.text).toContain("scale out half");
    expect(
      quoteUrlAllowed(
        jupiterQuoteUrl("So11111111111111111111111111111111111111112", quote.mint, "1000000"),
      ),
    ).toBe(true);
    expect(quoteUrlAllowed("https://quote-api.jup.ag/v6/swap")).toBe(false);
    expect(quoteUrlAllowed(dexScreenerTokenUrl([quote.mint]))).toBe(true);
    expect(quoteUrlAllowed(geckoTerminalTokenUrl(quote.mint))).toBe(true);
    expect(quoteUrlAllowed("https://api.dexscreener.com/latest/dex/swap/abc")).toBe(false);
    expect(quoteUrlAllowed("https://quote.example/execute")).toBe(false);
    expect(quoteUrlAllowed("https://mainnet.helius-rpc.com/?api-key=secret")).toBe(false);
    expect(mintBucket("abc", 5)).toBe(mintBucket("abc", 5));
  });

  it("sends phase C alerts to the test chat and reports list changes weekly", () => {
    expect(resolveAlertChat({ destination: "test", testChatId: "99", adminChatId: "1" })).toEqual({
      chatId: "99",
      destination: "test",
    });
    expect(resolveAlertChat({ destination: "test", testChatId: null, adminChatId: "1" })).toEqual({
      blocked: true,
      reason: "test chat is not set",
    });
    expect(resolveAlertChat({ destination: "test", testChatId: "1", adminChatId: "1" })).toEqual({
      blocked: true,
      reason: "test chat must not be the admin chat",
    });
    const held = quietHold({
      now: new Date("2026-11-19T04:30:00.000Z"),
      quietHours: "23:00-07:00",
      kind: "exit",
      stage: null,
      strength: 0,
      sizePct: 0,
      minStrength: 0.7,
      minSizePct: 2,
    });
    expect(held).toBe(false);
    const text = formatWeeklyReview({
      week: "2026-11-16",
      walletChanges: ["+wallet-a", "-wallet-b"],
      xChanges: ["X mention source is off"],
      promotionsWaiting: ["wallet-c"],
      paper: {
        status: "collecting",
        alerts: 1,
        bankrollPnl: 0.01,
        leaveOneOutPnl: null,
        medianNet: 0.01,
        controlPnl: null,
        controlAlerts: 0,
        maxDrawdownPct: 0,
        weeks: [],
        powerSampleSize: 385,
        powerWarning: null,
      },
    });
    expect(text).toContain("wallet list: +wallet-a, -wallet-b");
    expect(text).toContain("X mention source is off");
    expect(text).toContain("wallet-c");
  });

  it("registers before any paper entry and prices a curve bid at the stage size", () => {
    const mint = mintFor("trench", 0, "screen_only", "Reg");
    const unregistered = runPhaseCPass(pass({ locked: null, coins: [coin(mint)] }));
    expect(unregistered.entries).toEqual([]);
    expect(unregistered.lock).not.toBeNull();
    const bid = parseJupiterQuote(
      {
        inAmount: "333333333",
        outAmount: "1000000",
        priceImpactPct: "0.02",
        routePlan: [{ swapInfo: { feeAmount: "1000" } }],
      },
      50,
    );
    expect(bid.ok).toBe(true);
    if (bid.ok) {
      expect(bid.outAmount).toBe("1000000");
      expect(bid.impactPct).toBeCloseTo(2);
      expect(bid.feeUsd).toBeGreaterThan(0);
      expect(bid.liquidityUsd).toBeNull();
    }
    const sell = parseJupiterQuote(
      {
        inAmount: "1000000",
        outAmount: "200000000",
        priceImpactPct: "0.1115",
        routePlan: [{ swapInfo: { feeAmount: "1" } }],
      },
      { sizeUsd: 5, side: "sell", solPriceUsd: 150 },
    );
    expect(sell.ok && sell.impactPct).toBeCloseTo(11.15);
    expect(sell.ok && sell.liquidityUsd).toBeCloseTo(liquidityFromSellImpact(5, 11.15) ?? 0);
    const wrapped = JSON.stringify({ config: config(), rules, entriesStartAt: null });
    expect(parseLockedConfig(wrapped).paperMinAlerts).toBe(config().paperMinAlerts);
    expect(jupiterRatePerMin(false)).toBe(24);
    expect(jupiterRatePerMin(true)).toBe(48);
    expect(GECKO_REQUESTS_PER_MIN).toBe(6);
    const dex = parseDexScreener({
      pairs: [
        {
          baseToken: { address: mint },
          priceUsd: "1",
          liquidity: { usd: 9000 },
          volume: { h1: 10, h6: 40, h24: 100 },
        },
      ],
    });
    expect(dex[0]?.volumeUsd24h).toBe(100);
    expect(dex[0]?.liquidityUsd).toBe(9000);
    const dead = quotedRoundTrip(bid, { ok: false, reason: "no_liquidity" });
    expect(dead).toBe(-1);
    const curve = bankrollCurve([
      { sizePct: 2, net: -1 },
      { sizePct: 2, net: 0.5 },
    ]);
    expect(curve.maxDrawdownPct).toBeCloseTo(2, 5);
    expect(curve.pnl).toBeCloseTo(-0.01, 5);
    expect(powerSampleSize()).toBe(385);
    const bucket = takeTokens({ tokens: 1, refilledAt: 0 }, 0, 10, 3);
    expect(bucket.granted).toBe(1);
    expect(fomoFeeUsd(4)).toBe(0.1);
    expect(fomoFeeUsd(10)).toBeCloseTo(0.2);
    expect(fomoFeeUsd(100)).toBe(0.95);
    expect(fomoFeeUsd(200)).toBeCloseTo(1);
    expect(fomoFeeUsd(100, "solana_other")).toBe(0.95);
    const route = quotedRoundTrip(bid, { ok: false, reason: "no_route" });
    expect(route).toBe(-1);
  });

  it("keeps the control arm off telegram and out of the go decision", () => {
    const strategy = Array.from({ length: 100 }, (_unused, index) => ({
      at: new Date(Date.UTC(2026, 10, 2, 0, index)),
      arm: "screen_only" as const,
      net: index === 0 ? 5 : -0.02,
      sizePct: 2,
    }));
    const outlier = evaluatePaper({
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
      now: new Date("2026-11-03T00:00:00.000Z"),
      windowDays: 7,
      minAlerts: 100,
      maxDrawdownPct: 15,
      returns: strategy,
    });
    expect(outlier.bankrollPnl).toBeGreaterThan(0);
    expect(outlier.status).toBe("no_go");
    const mixed = evaluatePaper({
      registeredAt: new Date("2026-11-01T00:00:00.000Z"),
      now: new Date("2026-11-03T00:00:00.000Z"),
      windowDays: 7,
      minAlerts: 100,
      maxDrawdownPct: 15,
      returns: [
        ...Array.from({ length: 100 }, (_unused, index) => ({
          at: new Date(Date.UTC(2026, 10, 2, 1, index)),
          arm: "wallets_x_screen" as const,
          net: 0.02,
          sizePct: 1,
        })),
        {
          at: new Date("2026-11-02T00:00:00.000Z"),
          arm: "random_pass" as const,
          net: -1,
          sizePct: 50,
        },
      ],
    });
    expect(mixed.status).toBe("go");
    expect(mixed.controlAlerts).toBe(1);
    expect(mixed.controlPnl).not.toBeNull();
    const controlMint = mintFor("trench", 0, "random_pass", "Ctrl");
    const alerted = runPhaseCPass(
      pass({
        coins: [coin(controlMint)],
        entriesStartAt: new Date("2026-11-19T00:00:00.000Z"),
      }),
    );
    expect(alerted.entries[0]?.arm).toBe("random_pass");
    expect(alerted.entries[0]?.heldReason).toBe("control");
    expect(alerted.entries[0]?.text).toContain("config ");
    expect(alerted.immediate.some((line) => line.includes(controlMint))).toBe(false);
    const flap = runPhaseCPass(
      pass({
        coins: [coin("0xabc")],
        entriesStartAt: new Date("2026-11-19T00:00:00.000Z"),
      }),
    );
    expect(flap.entries).toEqual([]);
    expect(flap.immediate.join("\n")).not.toMatch(/0x/i);
    expect(isFlapMint("0xabc")).toBe(true);
  });

  it("labels a modeled curve sell when Jupiter has no route", () => {
    const modeled = modeledSellQuote({
      virtualSolLamports: 30_000_000_000n,
      virtualTokenRaw: 1_000_000_000_000n,
      amountInRaw: 10_000_000_000n,
      solPriceUsd: 150,
      sizeUsd: 5,
    });
    expect(modeled.ok).toBe(true);
    if (modeled.ok) expect(modeled.source).toBe("curve_modeled");
    expect(lookupTradableInFomo("mint")).resolves.toEqual({
      tradableInFomo: null,
      minutesFromAlertToListed: null,
    });
    const screened = screenCoin(
      {
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
        transferFeeBps: 0,
        exitQuoteImpactPct: 1,
        top10HoldersPct: 10,
        sniperBundlePct: 1,
        liquidityUsd: 20_000,
        uniqueMakers1h: 80,
        creatorSells: 0,
        quoteError: false,
        roundTripCostPct: 1.5,
      },
      rules,
    );
    expect(screened.verdict).toBe("pass");
    const fallback = curveFallbackBid({
      bid: { ok: false, reason: "no_route" },
      graduated: false,
      virtualSolLamports: 30_000_000_000n,
      virtualTokenRaw: 1_000_000_000_000n,
      amountInRaw: "10000000000",
      solPriceUsd: 150,
      sizeUsd: 5,
    });
    expect(fallback?.ok && fallback.source).toBe("curve_modeled");
    expect(
      curveFallbackBid({
        bid: { ok: false, reason: "no_route" },
        graduated: true,
        virtualSolLamports: 30_000_000_000n,
        virtualTokenRaw: 1_000_000_000_000n,
        amountInRaw: "10000000000",
        solPriceUsd: 150,
        sizeUsd: 5,
      }),
    ).toEqual({ ok: false, reason: "no_route" });
    const review = formatWeeklyReview({
      week: "2026-11-16",
      walletChanges: [],
      xChanges: [],
      promotionsWaiting: [],
      paper: {
        status: "collecting",
        alerts: 0,
        bankrollPnl: null,
        leaveOneOutPnl: null,
        medianNet: null,
        controlPnl: null,
        controlAlerts: 0,
        maxDrawdownPct: 0,
        weeks: [],
        powerSampleSize: 385,
        powerWarning: null,
      },
      tradable: { yes: 0, no: 0, unknown: 3 },
      walletScore: {
        scoringVersion: 3,
        lookbackStart: "2026-01-01T00:00:00.000Z",
        lookbackEnd: "2026-01-20T00:00:00.000Z",
        entryCount: 12,
        cutoff: "2026-01-16T00:00:00.000Z",
        rankedCount: 0,
      },
    });
    expect(review).not.toContain("tradable in fomo");
    expect(review).toContain("dry-run 0");
  });

  it("waits until entryAfter and uses the entry bid rather than the screen quote", () => {
    const mint = "Delay111111111111111111111111111111111111";
    const alertAt = new Date("2026-11-19T16:30:00.000Z");
    const entryAfter = new Date(alertAt.getTime() + 90_000);
    const position = {
      id: "p-delay",
      mint,
      stage: "trench" as const,
      arm: "screen_only" as const,
      status: "pending" as const,
      alertAt,
      entryAfter,
      openedAt: null,
      entryQuote: null,
      sizePct: 0.5,
      exitPlan: "stop",
      screenFailed: false,
    };
    const screenKey = `${mint}|screen|1x`;
    const entryKey = `${mint}|entry|1x`;
    const early = runPhaseCPass(
      pass({
        now: alertAt,
        positions: [position],
        bids: {
          [entryKey]: {
            ok: true,
            execPriceUsd: 2,
            midPriceUsd: 2,
            impactPct: 1,
            feeUsd: 0,
            sizeUsd: 50,
            liquidityUsd: 1,
            inAmount: "1",
            outAmount: "2",
          },
        },
      }),
    );
    expect(early.opens).toEqual([]);
    const opened = runPhaseCPass(
      pass({
        now: entryAfter,
        positions: [position],
        bids: {
          [screenKey]: {
            ok: true,
            execPriceUsd: 9,
            midPriceUsd: 9,
            impactPct: 1,
            feeUsd: 0,
            sizeUsd: 50,
            liquidityUsd: 1,
            inAmount: "1",
            outAmount: "9",
          },
          [entryKey]: {
            ok: true,
            execPriceUsd: 2,
            midPriceUsd: 2,
            impactPct: 1,
            feeUsd: 0,
            sizeUsd: 50,
            liquidityUsd: 1,
            inAmount: "1",
            outAmount: "2",
          },
        },
      }),
    );
    expect(opened.opens[0]?.quote).toBe(2);
    expect(opened.opens[0]?.fomoFeeUsd).toBe(fomoFeeUsd(50));
  });
});
