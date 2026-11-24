import { describe, expect, it } from "vitest";

import { fillAmountUsable } from "../ingest/fillCheck.js";
import { SOL_MINT } from "./quote.js";
import { exitStateFor, missingnessReport } from "./quoteState.js";
import { readTokenExtensions } from "./token2022.js";
import { screenCoin, type ScreenRules } from "./screen.js";

const rules: ScreenRules = {
  failMintAuthority: true,
  failFreezeAuthority: true,
  transferFeeBpsAbove: 300,
  exitImpactPctAbove: 5,
  entryImpactPctAbove: 10,
  top10FailAbove: 50,
  top10Warn: 35,
  sniperWarn: 30,
  minLiquidityUsd: 15_000,
  minMakers1h: 50,
};

function facts(overrides: Record<string, unknown> = {}) {
  return {
    mintAuthorityActive: false,
    freezeAuthorityActive: false,
    transferFeeBps: 0,
    exitQuoteImpactPct: 1,
    entryQuoteImpactPct: 1,
    top10HoldersPct: 10,
    sniperBundlePct: 90,
    liquidityUsd: 20_000,
    uniqueMakers1h: 80,
    creatorSells: 0,
    quoteError: false,
    ...overrides,
  };
}

describe("review rules", () => {
  it("does not fail a coin only because the raw sniper share is high", () => {
    expect(screenCoin(facts(), rules).verdict).toBe("pass");
  });

  it("does not pass when token extensions are unknown or dangerous", () => {
    expect(screenCoin(facts({ tokenExtension: "unknown" }), rules).verdict).toBe("watch");
    expect(screenCoin(facts({ tokenExtension: "dangerous" }), rules).verdict).toBe("fail");
    expect(screenCoin(facts({ tokenExtension: "clear" }), rules).verdict).toBe("pass");
  });

  it("names the holder denominator", () => {
    const failed = screenCoin(facts({ top10HoldersPct: 80 }), rules);
    expect(failed.hard.join(" ")).toContain("of total supply");
  });

  it("keeps a routing failure out of the primary mean and shows the sensitivity", () => {
    const state = exitStateFor({
      bid: { ok: false, reason: "no_route" },
      horizonReached: true,
      onChainUntradable: false,
      transferRestricted: false,
      netIfPriced: null,
    });
    expect(state).toEqual({ state: "routing_failure", net: null });
    const report = missingnessReport([
      { arm: "wallet", state: "priced", net: 0.2 },
      { arm: "wallet", state: "routing_failure", net: null },
      { arm: "control", state: "priced", net: 0 },
    ]);
    expect(report.byArm.find((row) => row.arm === "wallet")?.missing).toBe(1);
    expect(report.byArm.find((row) => row.arm === "wallet")?.trials).toBe(2);
    expect(report.primaryGap).toBeGreaterThan(0);
    expect(report.conservativeGap).toBeLessThan(0);
    expect(report.decisionFlips).toBe(true);
  });

  it("does not treat wrapped sol or a rent-sized change as a token quantity", () => {
    expect(fillAmountUsable({ mint: SOL_MINT, solAmount: -1, tokenAmount: 1 }).usable).toBe(false);
    expect(fillAmountUsable({ mint: "coin", solAmount: -0.0001, tokenAmount: 10 }).usable).toBe(
      false,
    );
    expect(fillAmountUsable({ mint: "coin", solAmount: null, tokenAmount: 10 }).usable).toBe(false);
    expect(fillAmountUsable({ mint: "coin", solAmount: -0.05, tokenAmount: 1000 }).usable).toBe(
      true,
    );
  });

  it("reads a transfer hook as dangerous and metadata as clear", () => {
    const data = new Uint8Array(166 + 4 + 64);
    data[165] = 1;
    data[166] = 14;
    data[168] = 64;
    data[166 + 4 + 32] = 1;
    expect(readTokenExtensions(data).status).toBe("dangerous");
    const meta = new Uint8Array(166 + 4 + 64);
    meta[165] = 1;
    meta[166] = 18;
    meta[168] = 64;
    expect(readTokenExtensions(meta).status).toBe("clear");
    expect(readTokenExtensions(new Uint8Array(82)).status).toBe("classic");
    expect(readTokenExtensions(new Uint8Array(100)).status).toBe("unknown");
  });
});
