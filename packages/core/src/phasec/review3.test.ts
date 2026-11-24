import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reconstructActivity } from "../ingest/fillCheck.js";
import { referenceCheckPlan } from "../ingest/referenceSchedule.js";
import { exitStateFor } from "./quoteState.js";
import { buildCandidateLog } from "./outcomes.js";
import type { ScreenRules } from "./screen.js";
import {
  acceptEntryObservation,
  accumulation,
  applyMissingAssumption,
  chooseFirstValidExit,
  classifyFill,
  enrollmentEstimate,
  isExcludedProtocol,
  labeledPairMeans,
  measureBootstrapCalibration,
  matchBenchmark,
  matchContemporaneous,
  MIN_BUY_SOL,
  missingnessChangesDecision,
  poolCanHoldNotional,
  qualificationGate,
  REQUIRED_MIGRATIONS,
  recallWalletSwaps,
  scenarioFills,
  simulateEqualBankrolls,
  validateExperimentConfig,
  type MatchCoin,
} from "./review3.js";

const at = "2026-11-24T12:02:00.000Z";

function coin(mint: string, overrides: Partial<MatchCoin> = {}): MatchCoin {
  return {
    mint,
    venue: "pump",
    liquidityUsd: 20_000,
    minutesSinceGraduation: 5,
    hourUtc: 12,
    decisionAt: at,
    ...overrides,
  };
}

describe("review 3", () => {
  it("labels the 0.095 example without using 0.0475 as the primary mean", () => {
    const labeled = labeledPairMeans([
      { wallet: 0, control: -0.095, walletUnfilled: true },
      { wallet: null, control: 0.1 },
    ]);
    expect(labeled.enrolled).toBe(2);
    expect(labeled.resolved).toBe(1);
    expect(labeled.unresolved).toBe(1);
    expect(labeled.fullPopulationMean).toBe("UNKNOWN");
    expect(labeled.completePairMean).toBeCloseTo(0.095);
    expect(labeled.filledOnlyMean).toBeNull();
    expect(labeled.zeroImputationMean).toBeCloseTo(0.0475);
  });

  it("does not impute zero for an unresolved pair", () => {
    const estimate = enrollmentEstimate([
      { wallet: 0, control: -0.095, walletUnfilled: true },
      { wallet: null, control: 0.1 },
    ]);
    expect(estimate.enrolled).toBe(2);
    expect(estimate.known).toBe(1);
    expect(estimate.unresolved).toBe(1);
    expect(estimate.fullPopulation).toBe("not_identifiable");
    expect(estimate.completeCaseMean).toBeCloseTo(0.095);
    const hostile = applyMissingAssumption(
      [
        { wallet: 0, control: -0.095, walletUnfilled: true },
        { wallet: null, control: 0.1 },
      ],
      "wallet_lost",
    );
    expect(hostile).toBeCloseTo((0 - -0.095 + (-1 - 0.1)) / 2);
    const decision = missingnessChangesDecision({
      completeLow: 0.09,
      completeHigh: 0.1,
      walletMean: 0.02,
      requiredReturn: 0,
      assumedMeans: [hostile, null],
      gatesPass: true,
    });
    expect(decision.inconclusive).toBe(true);
  });

  it("matches only a validated contemporaneous pool and does not redraw", () => {
    const wallets = [coin("wallet")];
    const screened = [
      coin("same"),
      coin("other-hour", { hourUtc: 1 }),
      coin("old", { decisionAt: "2026-11-23T12:02:00.000Z" }),
      coin("far-age", { minutesSinceGraduation: 28 }),
    ];
    const once = matchContemporaneous({ wallets, screened, allowlist: ["pump"] });
    const twice = matchContemporaneous({ wallets, screened, allowlist: ["pump"] });
    expect(once).toEqual(twice);
    expect(once.pairs[0]).toMatchObject({ control: "same", tier: "exact" });
    const adjacent = matchContemporaneous({
      wallets,
      screened: [coin("near", { minutesSinceGraduation: 12 })],
      allowlist: ["pump"],
    });
    expect(adjacent.pairs[0]?.tier).toBe("age_adjacent");
    const none = matchContemporaneous({ wallets, screened, allowlist: [] });
    expect(none.unmatched[0]?.reason).toBe("venue_not_validated");
    const reserved = matchContemporaneous({
      wallets: [coin("w1"), coin("w2")],
      screened: [coin("only")],
      allowlist: ["pump"],
    });
    expect(reserved.pairs).toHaveLength(1);
    expect(reserved.unmatched.map((row) => row.reason)).toContain("stratum_empty");
  });

  it("draws the benchmark from its own universe and skips an enrolled mint", () => {
    const result = matchBenchmark({
      wallets: [coin("wallet")],
      universe: [coin("fresh"), coin("wallet")],
      enrolled: new Set(["wallet"]),
      allowlist: ["pump"],
    });
    expect(result.pairs[0]?.benchmark).toBe("fresh");
  });

  it("keeps a sell under the minimum buy and does not call wrapped SOL the coin", () => {
    expect(MIN_BUY_SOL).toBe(0.002);
    const sell = classifyFill({
      mint: "coin",
      wrappedSolMint: "So11111111111111111111111111111111111111112",
      side: "sell",
      solAmount: -0.0001,
      tokenAmount: -10,
    });
    expect(sell.countsInNet).toBe(true);
    const swap = reconstructActivity([
      {
        signature: "sig",
        mint: "So11111111111111111111111111111111111111112",
        side: "swap",
        solAmount: -1,
        tokenAmount: 1,
        venue: "pump",
      },
      {
        signature: "sig",
        mint: "coin",
        side: "buy",
        solAmount: -1,
        tokenAmount: 10,
        venue: "pump",
      },
      {
        signature: "sig2",
        mint: "coin",
        side: "sell",
        solAmount: 0.0001,
        tokenAmount: -4,
        venue: "meteora",
        priced: false,
      },
    ]);
    expect(swap.paymentLegs).toHaveLength(1);
    expect(swap.activityCount).toBe(3);
    expect(swap.venues).toEqual(["pump", "meteora"]);
    expect(swap.status).toBe("net_buyer");
    expect(referenceCheckPlan().walletFeedRecall.enabled).toBe(false);
    expect(
      exitStateFor({
        bid: {
          ok: true,
          execPriceUsd: 1,
          midPriceUsd: 1,
          impactPct: 50,
          feeUsd: 0,
          sizeUsd: 20,
          liquidityUsd: null,
          inAmount: "1",
          outAmount: "1",
        },
        horizonReached: true,
        onChainUntradable: false,
        transferRestricted: false,
        platformRestricted: true,
        netIfPriced: -0.4,
      }).state,
    ).toBe("platform_restriction");
    const payment = classifyFill({
      mint: "So11111111111111111111111111111111111111112",
      wrappedSolMint: "So11111111111111111111111111111111111111112",
      side: "swap",
      solAmount: 1,
      tokenAmount: 1,
    });
    expect(payment.role).toBe("payment_leg");
    const solOnly = classifyFill({
      mint: "coin",
      wrappedSolMint: "So111",
      side: "buy",
      solAmount: 1,
      tokenAmount: null,
    });
    expect(solOnly.role).toBe("sol_only");
    expect(
      accumulation({
        fills: [sell, { role: "unclassified", countsInNet: false, qualifyingBuy: false }],
        venuesObserved: ["pump"],
        venuesRequired: ["pump", "meteora"],
      }).status,
    ).toBe("unknown");
  });

  it("refuses scale-out, a thin pool, a late entry, and the cancelled protocol", () => {
    expect(
      validateExperimentConfig({
        mode: "shadow",
        draft: true,
        commit: null,
        venueAllowlist: [],
        notionalUsd: 20,
        scaleOut: true,
        stops: false,
        walletListVersion: null,
      }).reason,
    ).toBe("scale_out_refused");
    expect(poolCanHoldNotional(1000, 20)).toBe(false);
    expect(poolCanHoldNotional(5_000, 20)).toBe(true);
    const entryAt = new Date("2026-11-24T12:05:00.000Z");
    expect(
      acceptEntryObservation({
        entryAt,
        observedAt: new Date("2026-11-24T12:15:00.000Z"),
        valid: true,
      }).usable,
    ).toBe(false);
    const exit = chooseFirstValidExit(
      [
        { at: new Date("2026-11-24T13:07:00.000Z"), valid: true, price: 9 },
        { at: new Date("2026-11-24T13:06:00.000Z"), valid: true, price: 1 },
      ],
      new Date("2026-11-24T13:05:00.000Z"),
      3 * 60 * 1000,
    );
    expect(exit?.price).toBe(1);
    expect(isExcludedProtocol("c1d34366abcdef")).toBe(true);
  });

  it("freezes pairs before fee scenarios and simulates both bankrolls", () => {
    const high = scenarioFills({
      pairIds: ["a", "b"],
      schedule: "solana_other",
      tokenCashUsd: 19.05,
      entryImpactPct: 4,
      capPct: 10,
    });
    const low = scenarioFills({
      pairIds: ["a", "b"],
      schedule: "solana_lowest_fee",
      tokenCashUsd: 19.6,
      entryImpactPct: 4,
      capPct: 10,
    });
    expect(high.map((row) => row.pairId)).toEqual(low.map((row) => row.pairId));
    expect(high[0]?.observedRoute).toBe("unknown");
    const books = simulateEqualBankrolls({
      wallet: [0.1, null, 0.2],
      control: [0.1, 0.1],
      bankroll: 100,
      notional: 20,
      maxConcurrent: 1,
    });
    expect(books.walletCash).toBeCloseTo(82);
    expect(books.reserved).toBe(20);
    expect(books.skipped).toBe(1);
  });

  it("does not count shadow days until the qualification gate passes", () => {
    expect(
      qualificationGate({
        ciGreenOnCommit: true,
        isolationTested: true,
        walletClassificationTested: true,
        matchingImmutable: true,
        horizonRecordsHonest: true,
        venueRecallScheduled: false,
        configChangedDuringShadow: false,
      }).countDays,
    ).toBe(false);
    const loop = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../../../apps/ingestor/src/loop.ts",
      ),
      "utf8",
    );
    expect(loop).not.toContain("recallWalletSwaps");
    expect(recallWalletSwaps({ known: new Set(["a"]), reference: ["a", "b"] }).missing).toEqual([
      "b",
    ]);
  });

  it("can benchmark a coin that failed the screen", () => {
    const now = new Date("2026-11-24T12:10:00.000Z");
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
    const base = {
      createdAt: new Date("2026-11-24T10:00:00.000Z"),
      graduatedAt: new Date("2026-11-24T12:00:00.000Z"),
      curveCompletedAt: null,
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
      poolType: "pump",
    };
    const rows = buildCandidateLog({
      now,
      rules,
      paused: false,
      entries: [],
      prices: new Map(),
      experiment: true,
      venueAllowlist: ["pump"],
      coins: [
        { ...base, mint: "backed", trackedBuyers: 2 },
        { ...base, mint: "failed-screen", trackedBuyers: 0, mintAuthorityActive: true },
      ],
    });
    expect(rows.find((row) => row.mint === "failed-screen")?.group).toBe("pre_screen");
  });

  it("names the migration set the combined stack requires", () => {
    const ddl = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../db/ingest.ts"),
      "utf8",
    );
    for (const id of REQUIRED_MIGRATIONS) expect(ddl).toContain(id);
    expect(ddl).toContain("set local lock_timeout = '3s'");
    expect(ddl).toContain("on conflict (id) do nothing");
  });

  it("measures bootstrap false positives, coverage, and power", () => {
    const measured = measureBootstrapCalibration(11);
    expect(measured).toEqual({
      sims: 1000,
      falsePositiveRate: 0.019,
      falsePositiveLow: 0.012196885750790904,
      falsePositiveHigh: 0.02948445591231312,
      intervalCoverage: 0.798,
      coverageLow: 0.771996830196033,
      coverageHigh: 0.8217224217465763,
      powerAt15pp: 0.769,
      powerLow: 0.7418776678486424,
      powerHigh: 0.7940635360861289,
    });
  });
});
