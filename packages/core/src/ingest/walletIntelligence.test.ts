import { describe, expect, it } from "vitest";

import {
  classifyMovement,
  sharedFunding,
  walletEvidence,
  walletMeasures,
} from "./walletIntelligence.js";

describe("wallet intelligence", () => {
  it("keeps graduation, the wallet fill, and the follower as separate results", () => {
    const measures = walletMeasures(
      {
        wallet: "wallet-a",
        mint: "mint-a",
        side: "buy",
        graduated: true,
        fillPriceUsd: 1,
        delayedMarkUsd: 2,
        exitMarkUsd: null,
      },
      null,
    );
    expect(measures.graduation).toEqual({ graduated: true, countedAsWin: false });
    expect(measures.ownResult).toEqual({ status: "present", fillPriceUsd: 1 });
    expect(measures.follower.status).toBe("insufficient");
    expect(measures.follower.jupiterNet).toBeNull();
    const priced = walletMeasures(
      {
        wallet: "wallet-a",
        mint: "mint-a",
        side: "buy",
        graduated: false,
        delayedMarkUsd: 2,
        exitMarkUsd: 3,
      },
      0.1,
    );
    expect(priced.follower.status).toBe("present");
    expect(priced.follower.jupiterNet).toBe(0.1);
    expect(priced.follower.sensitivityFomoNet).not.toBeNull();
    expect(priced.ownResult.status).toBe("insufficient");
  });

  it("classifies one of each movement and leaves an unknown name visible", () => {
    expect(classifyMovement("buy")).toBe("swap");
    expect(classifyMovement("transferChecked")).toBe("transfer");
    expect(classifyMovement("syncNative")).toBe("wrapped_sol");
    expect(classifyMovement("collectFee")).toBe("fee");
    expect(classifyMovement("createAccount")).toBe("account");
    expect(classifyMovement("mysteryOp")).toBe("unclassified");
  });

  it("shows concentration and does not treat a shared funder as common control", () => {
    const evidence = walletEvidence({
      wallet: "wallet-a",
      rows: [
        { boughtAt: new Date(0), exitedAt: new Date(60_000), followerNet: 10 },
        { boughtAt: new Date(0), exitedAt: new Date(120_000), followerNet: 1 },
        { boughtAt: null, exitedAt: null, followerNet: null },
        { boughtAt: new Date(0), exitedAt: new Date(30_000), followerNet: -2 },
      ],
    });
    expect(evidence.sampleSize).toBe(4);
    expect(evidence.missing).toBe(1);
    expect(evidence.downside).toBe(-2);
    expect(evidence.concentration).toBeCloseTo(10 / 11);
    expect(evidence.holdingPeriodMs).toBe(60_000);
    const funding = sharedFunding([
      { wallet: "wallet-a", funder: "funder-1" },
      { wallet: "wallet-b", funder: "funder-1" },
    ]);
    expect(funding).toEqual([
      { funder: "funder-1", wallets: ["wallet-a", "wallet-b"], commonControl: false },
    ]);
    expect(new Set(funding[0]?.wallets).size).toBe(2);
  });
});
