import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MICROS_PER_CREDIT, allowanceCredits } from "./budget.js";
import {
  LAUNCHLAB_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  WALLET_SUB_CHUNK,
  WALLET_TRADE_NAMES,
} from "./programs.js";
import { historyMarkForBuy } from "./historyMarks.js";
import {
  applyLossMaturity,
  chunkWallets,
  mayApplyV3List,
  nextTrackedSet,
  scoreProvenWallets,
  walletBudgetOpen,
  walletCreditCapMicros,
  walletFillsFromParsed,
  type EarlyBuy,
  type ScoredWallet,
} from "./wallets.js";

const graduated = (wallet: string, mint: string, side: "buy" | "sell"): EarlyBuy => ({
  wallet,
  mint,
  side,
  graduated: true,
  delayedMarkUsd: side === "buy" ? 1 : null,
  delayedMarkSource: side === "buy" ? "jupiter" : null,
  exitMarkUsd: side === "buy" ? 1.5 : null,
  boughtAt: new Date("2026-01-01T00:00:00.000Z"),
});

const loss = (wallet: string, mint: string): EarlyBuy => ({
  wallet,
  mint,
  side: "buy",
  graduated: false,
  delayedMarkUsd: 1,
  delayedMarkSource: "jupiter",
  exitMarkUsd: 0.5,
  boughtAt: new Date("2026-01-02T00:00:00.000Z"),
});

describe("proven wallets", () => {
  it("requires a known loss and shrinks a perfect hit rate", () => {
    const onlyWins = scoreProvenWallets(
      [graduated("winner", "mint-a", "buy"), graduated("winner", "mint-b", "buy")],
      300,
      { minEntries: 2, minLosses: 1 },
    );
    expect(onlyWins).toEqual([]);
    const scored = scoreProvenWallets(
      [
        graduated("winner", "mint-a", "buy"),
        graduated("winner", "mint-b", "buy"),
        loss("winner", "mint-c"),
        { wallet: "unknown", mint: "mint-d", side: "buy", graduated: false, outcomeKnown: false },
        { wallet: "unknown", mint: "mint-e", side: "buy", graduated: false, outcomeKnown: false },
        graduated("seller", "mint-a", "buy"),
        graduated("seller", "mint-a", "sell"),
        graduated("seller", "mint-b", "buy"),
        graduated("seller", "mint-b", "sell"),
      ],
      300,
      { minEntries: 2, minLosses: 1 },
    );
    expect(scored.map((row) => row.address)).toEqual(["winner"]);
    expect(scored[0]).toMatchObject({ earlyEntries: 3, earlyWins: 2, hitRate: 3 / 5 });
    expect(scored[0]?.derivation).toContain("cluster_unknown");
  });

  it("drops same-slot snipers, same-slot scalps, and very wide bots", () => {
    const sniper = scoreProvenWallets(
      [
        {
          wallet: "snipe",
          mint: "mint-a",
          side: "buy",
          graduated: true,
          slot: 10,
          createdSlot: 10,
        },
        loss("snipe", "mint-b"),
      ],
      300,
      { minEntries: 1, minLosses: 1 },
    );
    expect(sniper).toEqual([]);
    const laterBuy = scoreProvenWallets(
      [
        {
          wallet: "snipe",
          mint: "mint-a",
          side: "buy",
          graduated: true,
          slot: 20,
          createdSlot: 10,
        },
        {
          wallet: "snipe",
          mint: "mint-a",
          side: "buy",
          graduated: true,
          slot: 10,
          createdSlot: 10,
        },
        loss("snipe", "mint-b"),
      ],
      300,
      { minEntries: 1, minLosses: 1 },
    );
    expect(laterBuy).toEqual([]);
    const scalp = scoreProvenWallets(
      [
        { ...graduated("bot", "mint-a", "buy"), slot: 8, createdSlot: 1 },
        { ...graduated("bot", "mint-a", "sell"), slot: 8, createdSlot: 1 },
        { ...graduated("bot", "mint-b", "buy"), slot: 9, createdSlot: 1 },
        { ...loss("bot", "mint-c"), slot: 12, createdSlot: 1 },
      ],
      300,
      { minEntries: 2, minLosses: 1, minShrunkRate: 0 },
    );
    expect(scalp.map((row) => row.address)).toEqual(["bot"]);
    expect(scalp[0]?.earlyEntries).toBe(2);
    const wide = Array.from({ length: 4 }, (_unused, index) => ({
      wallet: "wide",
      mint: `mint-${index.toString()}`,
      side: "buy" as const,
      graduated: index === 0,
    }));
    expect(
      scoreProvenWallets(wide, 300, { minEntries: 2, minLosses: 1, botMaxEntries: 3 }),
    ).toEqual([]);
  });

  it("drops a wallet whose shrunk rate is under 0.6", () => {
    const scored = scoreProvenWallets(
      [
        graduated("low", "low-w1", "buy"),
        graduated("low", "low-w2", "buy"),
        loss("low", "low-l1"),
        loss("low", "low-l2"),
        loss("low", "low-l3"),
        graduated("kept", "kept-w1", "buy"),
        graduated("kept", "kept-w2", "buy"),
        loss("kept", "kept-l1"),
      ],
      300,
      { minEntries: 3, minLosses: 1 },
    );
    expect(scored.map((row) => row.address)).toEqual(["kept"]);
    expect(scored[0]).toMatchObject({ earlyEntries: 3, earlyWins: 2, hitRate: 0.6 });
  });

  it("ranks by the shrunk hit rate", () => {
    const rows: EarlyBuy[] = [];
    for (const wallet of ["b-wallet", "a-wallet"]) {
      rows.push(
        graduated(wallet, `${wallet}-1`, "buy"),
        graduated(wallet, `${wallet}-2`, "buy"),
        loss(wallet, `${wallet}-loss`),
      );
    }
    rows.push(graduated("a-wallet", "a-wallet-3", "buy"));
    const scored = scoreProvenWallets(rows, 2, { minEntries: 2, minLosses: 1 });
    expect(scored.map((row) => row.address)).toEqual(["a-wallet", "b-wallet"]);
    expect(scored[0]?.hitRate).toBeGreaterThan(scored[1]?.hitRate ?? 0);
  });

  it("leaves a young non-graduate unresolved and counts an old one as a loss", () => {
    const now = new Date("2026-11-18T12:00:00.000Z");
    const rows = applyLossMaturity(
      [
        {
          wallet: "a",
          mint: "young-pump",
          side: "buy",
          graduated: false,
          venue: "pump",
          createdAt: new Date(now.getTime() - 90 * 60 * 1000),
        },
        {
          wallet: "a",
          mint: "old-launch",
          side: "buy",
          graduated: false,
          venue: "launchlab",
          createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        },
        {
          wallet: "a",
          mint: "dbc",
          side: "buy",
          graduated: false,
          venue: "meteora",
          createdAt: new Date(now.getTime() - 90 * 60 * 1000),
        },
        {
          wallet: "a",
          mint: "graduated-young",
          side: "buy",
          graduated: true,
          venue: "pump",
          createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        },
      ],
      now,
    );
    expect(rows.find((row) => row.mint === "young-pump")?.outcomeKnown).toBe(false);
    expect(rows.find((row) => row.mint === "old-launch")?.outcomeKnown).toBe(true);
    expect(rows.find((row) => row.mint === "dbc")?.outcomeKnown).toBe(true);
    expect(rows.find((row) => row.mint === "graduated-young")?.outcomeKnown).toBe(true);
    const later = applyLossMaturity(
      [
        {
          wallet: "a",
          mint: "young-pump",
          side: "buy",
          graduated: true,
          venue: "pump",
          createdAt: new Date(now.getTime() - 90 * 60 * 1000),
        },
      ],
      now,
    );
    expect(later[0]?.outcomeKnown).toBe(true);
    expect(later[0]?.graduated).toBe(true);
  });

  it("rebuilds the live list when the scoring version changes", () => {
    const ranked = [scored("new-wallet")];
    const refresh = nextTrackedSet({
      ranked,
      active: ["old-a", "old-b", "old-c", "old-d", "old-e"],
      maxWallets: 5,
      maxChurnPct: 20,
      reset: true,
    });
    expect(refresh.keep).toEqual(["new-wallet"]);
    expect(refresh.replaced).toBe(5);
  });

  it("drops a graduation that has no delayed mark and a mark worse than the fill", () => {
    expect(
      scoreProvenWallets(
        [
          {
            wallet: "grad",
            mint: "g1",
            side: "buy",
            graduated: true,
            fillPriceUsd: 1,
          },
          loss("grad", "g2"),
        ],
        10,
        { minEntries: 1, minLosses: 1 },
      ),
    ).toEqual([]);
    const worse = scoreProvenWallets(
      [
        {
          wallet: "late",
          mint: "m1",
          side: "buy",
          graduated: true,
          fillPriceUsd: 1,
          delayedMarkUsd: 2,
          delayedMarkSource: "jupiter",
          exitMarkUsd: 1.2,
          boughtAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        loss("late", "m2"),
      ],
      10,
      { minEntries: 1, minLosses: 1 },
    );
    expect(worse).toEqual([]);
    const kept = scoreProvenWallets(
      [
        {
          wallet: "late",
          mint: "m1",
          side: "buy",
          graduated: false,
          fillPriceUsd: 3,
          delayedMarkUsd: 1,
          delayedMarkSource: "curve_modeled",
          exitMarkUsd: 1.4,
          boughtAt: new Date("2026-01-01T00:00:00.000Z"),
        },
        loss("late", "m2"),
      ],
      10,
      { minEntries: 1, minLosses: 1, minShrunkRate: 0 },
    );
    expect(kept.map((row) => row.address)).toEqual(["late"]);
  });

  it("requires ten entries and drops a wallet that fails the held-out window", () => {
    const rows: EarlyBuy[] = [];
    for (let index = 0; index < 8; index += 1) {
      rows.push({
        ...graduated("short", `s${index.toString()}`, "buy"),
        boughtAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
    }
    rows.push({
      ...loss("short", "sloss"),
      boughtAt: new Date(Date.UTC(2026, 0, 20)),
    });
    expect(scoreProvenWallets(rows, 10)).toEqual([]);
    const wide: EarlyBuy[] = [];
    for (let index = 0; index < 8; index += 1) {
      wide.push({
        ...graduated("wide", `w${index.toString()}`, "buy"),
        boughtAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
    }
    wide.push({ ...loss("wide", "hearly"), boughtAt: new Date(Date.UTC(2026, 0, 9)) });
    wide.push({
      ...graduated("wide", "wlate", "buy"),
      boughtAt: new Date(Date.UTC(2026, 0, 20)),
    });
    expect(scoreProvenWallets(wide, 10, { minEntries: 2, minLosses: 1, holdOut: true })).toEqual(
      [],
    );
    const creator = scoreProvenWallets(
      [{ ...graduated("creator", "own", "buy"), creator: true }, loss("creator", "other")],
      10,
      { minEntries: 1, minLosses: 1 },
    );
    expect(creator).toEqual([]);
  });

  it("uses a later swap as the delayed mark and keeps an empty v3 list off the reset", () => {
    const buy = {
      mint: "coin",
      wallet: "self",
      side: "buy" as const,
      slot: 1_000,
      blockTimeSec: 1_000_000,
      solAmount: 1,
      tokenAmount: 100,
      signature: "entry",
    };
    const near = {
      ...buy,
      wallet: "other",
      blockTimeSec: 1_000_090,
      solAmount: 2,
      tokenAmount: 100,
      signature: "near",
    };
    const own = { ...near, wallet: "self", signature: "entry" };
    const exit = {
      ...near,
      blockTimeSec: 1_000_000 + 2 * 60 * 60,
      solAmount: 3,
      tokenAmount: 100,
      signature: "exit",
    };
    const mark = historyMarkForBuy({ buy, swaps: [own, near, exit], horizonSec: 2 * 60 * 60 });
    expect(mark?.delayedMarkUsd).toBe(0.02);
    expect(mark?.delayedMarkSource).toBe("history_swap");
    expect(historyMarkForBuy({ buy, swaps: [own], horizonSec: 7200 })).toBeNull();
    expect(mayApplyV3List({ paperOpen: false, rankedCount: 0, testClosed: false })).toBe(false);
    expect(mayApplyV3List({ paperOpen: true, rankedCount: 4, testClosed: true })).toBe(false);
    expect(mayApplyV3List({ paperOpen: false, rankedCount: 4, testClosed: false })).toBe(false);
    expect(mayApplyV3List({ paperOpen: false, rankedCount: 4, testClosed: true })).toBe(true);
    expect(
      mayApplyV3List({
        paperOpen: false,
        rankedCount: 4,
        testClosed: true,
        listFrozen: true,
      }),
    ).toBe(false);
    const rows: EarlyBuy[] = [];
    for (let index = 0; index < 8; index += 1) {
      rows.push({
        ...graduated("hold", `h${index.toString()}`, "buy"),
        boughtAt: new Date(Date.UTC(2026, 0, index + 1)),
      });
    }
    rows.push({ ...loss("hold", "hloss"), boughtAt: new Date(Date.UTC(2026, 0, 9)) });
    rows.push({ ...loss("hold", "hloss2"), boughtAt: new Date(Date.UTC(2026, 0, 10)) });
    rows.push({
      ...graduated("hold", "hout-win", "buy"),
      boughtAt: new Date(Date.UTC(2026, 0, 28)),
    });
    rows.push({ ...loss("hold", "hout-loss"), boughtAt: new Date(Date.UTC(2026, 0, 29)) });
    const passed = scoreProvenWallets(rows, 10, {
      minEntries: 10,
      holdOut: true,
      holdOutMinEntries: 2,
      minLosses: 1,
      minShrunkRate: 0.5,
    });
    expect(passed.map((row) => row.address)).toEqual(["hold"]);
  });

  it("returns nothing when there is no stored early buy", () => {
    expect(scoreProvenWallets([], 300)).toEqual([]);
  });

  it("keeps the wallet instruction filter inside Helius's name limit", () => {
    expect(WALLET_TRADE_NAMES.length).toBeLessThanOrEqual(50);
    expect(new Set(WALLET_TRADE_NAMES).size).toBe(WALLET_TRADE_NAMES.length);
  });

  it("chunks at the Helius include limit", () => {
    const chunks = chunkWallets(
      Array.from({ length: WALLET_SUB_CHUNK + 1 }, (_unused, index) => `w${index.toString()}`),
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(WALLET_SUB_CHUNK);
    expect(chunks[1]).toHaveLength(1);
  });

  it("caps wallet credits at the configured share of the monthly allowance", () => {
    const allowance = allowanceCredits("developer", undefined);
    expect(allowance).toBe(10_000_000n);
    const cap = walletCreditCapMicros(allowance * MICROS_PER_CREDIT, 25);
    expect(cap / MICROS_PER_CREDIT).toBe(2_500_000n);
    expect(walletBudgetOpen(cap - 1n, cap)).toBe(true);
    expect(walletBudgetOpen(cap, cap)).toBe(false);
  });

  it("refreshes the live set and replaces at most the churn cap", () => {
    const ranked = ["a", "b", "c", "f", "g"].map((address) => scored(address));
    const first = nextTrackedSet({ ranked, active: [], maxWallets: 3, maxChurnPct: 20 });
    expect(first.keep).toEqual(["a", "b", "c"]);
    expect(first.replaced).toBe(0);
    const refresh = nextTrackedSet({
      ranked,
      active: ["a", "b", "c", "d", "e"],
      maxWallets: 5,
      maxChurnPct: 20,
    });
    expect(refresh.replaced).toBe(1);
    expect(refresh.added).toBe(1);
    expect(refresh.keep).toHaveLength(5);
    expect(refresh.keep.filter((address) => address === "d" || address === "e")).toHaveLength(1);
    const unchanged = nextTrackedSet({
      ranked: [],
      active: ["a"],
      maxWallets: 5,
      maxChurnPct: 20,
    });
    expect(unchanged).toMatchObject({ keep: ["a"], replaced: 0, added: 0, upsert: [] });
  });

  it("reads a tracked buy, sell, and undirected swap from a parsed notification", () => {
    const tracked = new Set(["tracked-wallet"]);
    const fills = walletFillsFromParsed(
      notification([
        instruction(PUMP_PROGRAM_ID, "buy", [
          ["user", "tracked-wallet"],
          ["mint", "coin-mint"],
        ]),
        instruction(PUMP_PROGRAM_ID, "sell", [
          ["user", "tracked-wallet"],
          ["mint", "coin-mint"],
        ]),
        instruction(LAUNCHLAB_PROGRAM_ID, "swap", [
          ["payer", "tracked-wallet"],
          ["base_mint", "coin-mint"],
          ["quote_mint", "So11111111111111111111111111111111111111112"],
        ]),
        instruction(LAUNCHLAB_PROGRAM_ID, "buy_exact_in", [
          ["user", "tracked-wallet"],
          ["base_mint", "other-mint"],
        ]),
      ]),
      tracked,
    );
    expect(fills.map((fill) => [fill.side, fill.venue, fill.mint])).toEqual([
      ["buy", "pump", "coin-mint"],
      ["sell", "pump", "coin-mint"],
      ["swap", "launchlab", "coin-mint"],
      ["buy", "launchlab", "other-mint"],
    ]);
    expect(fills.every((fill) => fill.wallet === "tracked-wallet")).toBe(true);
  });
});

function scored(address: string): ScoredWallet {
  return {
    address,
    earlyEntries: 2,
    earlyWins: 2,
    hitRate: 1,
    derivation: "test",
  };
}

function notification(instructions: unknown[]): unknown {
  return {
    jsonrpc: "2.0",
    method: "parsedTransactionNotification",
    params: {
      subscription: 77,
      result: {
        context: { slot: 10 },
        value: {
          transaction: { signature: "sig", slot: 10, error: null },
          instructions,
        },
      },
    },
  };
}

function instruction(
  programId: string,
  instructionName: string,
  accounts: Array<[string, string]>,
): unknown {
  return {
    programId,
    instructionName,
    decoded: {
      accounts: accounts.map(([name, pubkey]) => ({ name, pubkey })),
    },
  };
}

describe("x mention fixture file", () => {
  it("matches the mentions embedded for the offline dry-run", async () => {
    const { FIXTURE_X_MENTIONS } = await import("./xMentions.js");
    const file = JSON.parse(
      readFileSync(new URL("./fixtures/x-mentions.json", import.meta.url), "utf8"),
    ) as { mentions: unknown };
    expect(file.mentions).toEqual(FIXTURE_X_MENTIONS);
  });
});
