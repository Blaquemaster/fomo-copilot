import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reconstructActivity } from "../ingest/fillCheck.js";
import { reconciliationWindow, referenceCheckPlan } from "../ingest/referenceSchedule.js";
import { exitStateFor } from "./quoteState.js";
import { buildCandidateLog } from "./outcomes.js";
import type { ScreenRules } from "./screen.js";
import {
  acceptEntryObservation,
  accumulation,
  applyMissingAssumption,
  chooseFirstValidExit,
  classifyFill,
  decideIdentification,
  enrollmentEstimate,
  entryDeadline,
  exitDeadline,
  identificationBounds,
  isExcludedProtocol,
  labeledPairMeans,
  measureBootstrapCalibration,
  matchBenchmark,
  matchContemporaneous,
  MIN_BUY_SOL,
  missingnessChangesDecision,
  poolCanHoldNotional,
  DIAGNOSTIC_PHASE,
  diagnosticAllows,
  qualificationGate,
  qualificationRunId,
  REQUIRED_MIGRATIONS,
  scoreFeeScenarios,
  scoreIdentification,
  shadowClock,
  recallWalletSwaps,
  scenarioFills,
  simulateEqualBankrolls,
  valueUnresolvedFill,
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
    const cursor = new Date("2026-11-24T00:00:00.000Z");
    const window = reconciliationWindow({
      now: new Date("2026-11-24T18:00:00.000Z"),
      cursorAt: cursor,
      everyMs: referenceCheckPlan().venueRecall.everyMs,
    });
    expect(window.from.toISOString()).toBe(cursor.toISOString());
    expect(window.missedRuns).toBe(2);
    expect(qualificationRunId({ commit: null, walletListVersion: null, venueAllowlist: [] })).toBe(
      null,
    );
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
    const due = entryDeadline(new Date("2026-11-24T12:02:00.000Z"));
    expect(due.entryDueAt.toISOString()).toBe("2026-11-24T12:05:00.000Z");
    expect(due.latestEntryAt.toISOString()).toBe("2026-11-24T12:06:00.000Z");
    expect(
      acceptEntryObservation({
        entryDueAt: due.entryDueAt,
        observedAt: new Date("2026-11-24T12:06:00.000Z"),
        valid: true,
      }).usable,
    ).toBe(true);
    expect(
      acceptEntryObservation({
        entryDueAt: due.entryDueAt,
        observedAt: new Date("2026-11-24T12:06:01.000Z"),
        valid: true,
      }).usable,
    ).toBe(false);
    expect(exitDeadline(due.entryDueAt).toISOString()).toBe("2026-11-24T13:05:00.000Z");
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
    expect(books.spendableCash).toBeCloseTo(82);
    expect(books.capitalUnavailable).toBe(20);
    expect(books.equity).toBe("unknown");
    expect(books.skipped).toBe(1);
    const valued = valueUnresolvedFill({ bankroll: 1000, notional: 20, tokenQty: 100 });
    expect(valued.spendableCash).toBe(980);
    expect(valued.zeroRecoveryStressEquity).toBe(980);
    expect(valued.equity).toBe("unknown");
    expect(valued.opportunityReturn).toBe("unknown");
    expect(valued.controlsShadowEnrollment).toBe(false);
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
        venueScopeSet: false,
        walletListVersionSet: false,
        preflightPassed: false,
        diagnosticPhase: false,
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

  it("keeps the primary unknown and bounds every enrolled pair", () => {
    const bounds = identificationBounds([
      { wallet: { status: "unfilled" }, control: { status: "resolved", netReturn: -0.095 } },
      { wallet: { status: "filled_unresolved" }, control: { status: "resolved", netReturn: 0.1 } },
    ]);
    expect(bounds.pointEstimate).toBe("UNKNOWN");
    expect(bounds.evidenceLower).toBeCloseTo(-0.5025);
    expect(bounds.evidenceUpper).toBe("+infinity");
    expect(bounds.sensitivity.label).toBe("assumption-based");
    expect(bounds.sensitivity.walletLost).toBeCloseTo(-0.5025);
    expect(bounds.sensitivity.controlGained).toBeNull();
    expect(bounds.tippingPoint.status).toBe("not_separable");
    expect(() =>
      identificationBounds([
        {
          wallet: { status: "resolved", netReturn: -1.01 },
          control: { status: "resolved", netReturn: 0 },
        },
      ]),
    ).toThrow(/cash exposure exceeds the \$20 allocation/);
  });

  it("reports the missing-control return that puts the mean on +5pp", () => {
    const bounds = identificationBounds([
      {
        wallet: { status: "resolved", netReturn: 0.1 },
        control: { status: "resolved", netReturn: -0.1 },
      },
      { wallet: { status: "resolved", netReturn: 0.1 }, control: { status: "filled_unresolved" } },
    ]);
    expect(bounds.pointEstimate).toBe("UNKNOWN");
    expect(bounds.evidenceLower).toBe("-infinity");
    expect(bounds.evidenceUpper).toBeCloseTo(0.65);
    expect(bounds.tippingPoint.status).toBe("computed");
    expect(bounds.tippingPoint.averageMissingControlReturn).toBeCloseTo(0.2);
    expect(bounds.tippingPoint.dollarsPer20).toBeCloseTo(4);
    const erased = identificationBounds([
      {
        wallet: { status: "resolved", netReturn: -1 },
        control: { status: "resolved", netReturn: 0 },
      },
      { wallet: { status: "resolved", netReturn: 0 }, control: { status: "filled_unresolved" } },
    ]);
    expect(erased.tippingPoint.averageMissingControlReturn).toBeCloseTo(-1.1);
    expect(erased.tippingPoint.belowCashFloor).toBe(true);
    expect(erased.tippingPoint.dollarsPer20).toBeCloseTo(-22);
  });

  it("scores each fee scenario without enabling inferential Go", () => {
    const identified = [
      {
        wallet: { status: "resolved" as const, netReturn: 0.2 },
        control: { status: "resolved" as const, netReturn: 0 },
      },
    ];
    const calibration = {
      status: "calibrated" as const,
      lowerConfidenceBoundOnLowerBound: 0.06,
      upperConfidenceBoundOnUpperBound: 0.2,
    };
    const scored = scoreIdentification({
      feeScenario: "both_high",
      pairs: identified,
      economicsPass: true,
      riskPass: true,
      calibration,
    });
    expect(scored.call).toBe("inconclusive");
    expect(scored.inferentialGoEnabled).toBe(false);
    expect(scored.reasons).toContain("inferential_go_disabled");
    expect(scored.calibrationNote).toContain("60-day");
    expect(scored.pointEstimate).toBeCloseTo(0.2);
    const wouldGo = decideIdentification({
      feeScenario: "both_high",
      pairs: identified,
      economicsPass: true,
      riskPass: true,
      inferentialGoEnabled: true,
      calibration,
    });
    expect(wouldGo.call).toBe("go");
    expect(
      decideIdentification({
        feeScenario: "both_low",
        pairs: identified,
        economicsPass: true,
        riskPass: true,
        inferentialGoEnabled: true,
        calibration: {
          status: "calibrated",
          lowerConfidenceBoundOnLowerBound: 0.06,
          upperConfidenceBoundOnUpperBound: 0.04,
        },
      }).call,
    ).toBe("no_go");
    expect(
      decideIdentification({
        feeScenario: "adverse",
        pairs: identified,
        economicsPass: false,
        riskPass: true,
        inferentialGoEnabled: true,
        calibration,
      }).call,
    ).toBe("no_go");
    expect(
      decideIdentification({
        feeScenario: "both_high",
        pairs: identified,
        economicsPass: true,
        riskPass: true,
        inferentialGoEnabled: true,
        calibration: {
          status: "calibrated",
          lowerConfidenceBoundOnLowerBound: 0.04,
          upperConfidenceBoundOnUpperBound: 0.2,
        },
      }).call,
    ).toBe("inconclusive");
    const pending = {
      status: "pending" as const,
      lowerConfidenceBoundOnLowerBound: null,
      upperConfidenceBoundOnUpperBound: null,
    };
    const calls = scoreFeeScenarios({
      calibration: pending,
      scenarios: {
        both_high: { pairs: identified, economicsPass: true, riskPass: true },
        both_low: { pairs: identified, economicsPass: true, riskPass: true },
        adverse: { pairs: identified, economicsPass: false, riskPass: true },
      },
    });
    expect(calls.map((row) => [row.feeScenario, row.call])).toEqual([
      ["both_high", "inconclusive"],
      ["both_low", "inconclusive"],
      ["adverse", "no_go"],
    ]);
    expect(calls.every((row) => row.inferentialGoEnabled === false)).toBe(true);
  });

  it("starts the seven day clock only after preflight", () => {
    const ready = {
      ciGreenOnCommit: true,
      isolationTested: true,
      walletClassificationTested: true,
      matchingImmutable: true,
      horizonRecordsHonest: true,
      venueRecallScheduled: true,
      configChangedDuringShadow: false,
      venueScopeSet: true,
      walletListVersionSet: true,
      preflightPassed: false,
      diagnosticPhase: false,
    };
    expect(qualificationGate(ready).countDays).toBe(false);
    expect(qualificationGate(ready).reasons).toContain("preflight");
    expect(qualificationGate({ ...ready, preflightPassed: true }).countDays).toBe(true);
    expect(
      qualificationGate({ ...ready, preflightPassed: true, diagnosticPhase: true }).countDays,
    ).toBe(false);
    expect(diagnosticAllows("quote_collection")).toBe(true);
    expect(diagnosticAllows("paper")).toBe(false);
    expect(DIAGNOSTIC_PHASE.venueSelected).toBeNull();
    expect(DIAGNOSTIC_PHASE.selection).toBe("operational_only");
    expect(shadowClock({ preflightPassed: false, startedAt: null }).running).toBe(false);
    expect(
      shadowClock({ preflightPassed: true, startedAt: new Date("2026-11-24T00:00:00Z") }),
    ).toEqual({ running: true, days: 7, reason: null });
  });

  it("measures bootstrap false positives, coverage, and power", () => {
    expect(measureBootstrapCalibration(11)).toEqual({
      inferentialGoEnabled: false,
      scenarios: [
        {
          name: "complete_coverage_at_0",
          sims: 2000,
          estimand: "generating effect 0, complete pairs, cluster interval",
          rate: 0.9645,
          low: 0.95545893930598,
          high: 0.971760123769736,
          inferentialGoEnabled: false,
        },
        {
          name: "complete_false_go_at_5pp_boundary",
          sims: 2000,
          estimand: "generating effect +5pp, false claim that the lower bound exceeds +5pp",
          rate: 0.0185,
          low: 0.013451349814109871,
          high: 0.025394766717736703,
          inferentialGoEnabled: false,
        },
        {
          name: "complete_power_at_15pp",
          sims: 2000,
          estimand: "generating effect +15pp, lower bound above +5pp on complete data only",
          rate: 0.532,
          low: 0.5100914000331974,
          high: 0.5537859089408025,
          inferentialGoEnabled: false,
        },
        {
          name: "missing_primary_inconclusive",
          sims: 2000,
          estimand:
            "any unresolved pair makes the primary mean UNKNOWN, so the call is inconclusive",
          rate: 1,
          low: 0.9980829527187469,
          high: 0.9999999999999998,
          inferentialGoEnabled: false,
        },
      ],
    });
  });
});
