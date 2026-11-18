import { describe, expect, it, vi } from "vitest";

import { encodeBase58 } from "./base58.js";
import { historyPageCredits } from "./budget.js";
import {
  DBC_PROGRAM_ID,
  DBC_SWAP_ACCOUNTS,
  DISC,
  LAUNCHLAB_PROGRAM_ID,
  LAUNCHLAB_TRADE_ACCOUNTS,
  PUMP_PROGRAM_ID,
} from "./programs.js";
import {
  collectEarlyBuyers,
  earlyBuyerHistoryParams,
  earlyBuyersFromHistory,
  type BackfillTarget,
} from "./earlyBuyers.js";

describe("early-buyer history cost", () => {
  it("uses one oldest-first page and the documented 10-credit block", () => {
    const params = earlyBuyerHistoryParams("curve", null);
    const config = params[1] as {
      transactionDetails: string;
      sortOrder: string;
      limit: number;
      filters: { status: string };
    };
    expect(params[0]).toBe("curve");
    expect(config.transactionDetails).toBe("full");
    expect(config.sortOrder).toBe("asc");
    expect(config.limit).toBe(100);
    expect(config.filters.status).toBe("succeeded");
    expect(earlyBuyerHistoryParams("curve", "10:1")[1]).toMatchObject({ paginationToken: "10:1" });
    expect(historyPageCredits(0)).toBe(10);
    expect(historyPageCredits(100)).toBe(10);
    expect(historyPageCredits(101)).toBe(20);
  });
});

describe("early buyers from a history transaction", () => {
  it("keeps a non-creator Pump buy and drops the creator", () => {
    const rows = earlyBuyersFromHistory(pumpBuy("buyer-wallet"), {
      mint: "coin-mint",
      venue: "pump",
      creator: "creator-wallet",
    });
    expect(rows.map((row) => row.wallet)).toEqual(["buyer-wallet"]);
    expect(rows[0]?.side).toBe("buy");
    const creator = earlyBuyersFromHistory(pumpBuy("creator-wallet"), {
      mint: "coin-mint",
      venue: "pump",
      creator: "creator-wallet",
    });
    expect(creator).toEqual([]);
  });

  it("reads LaunchLab buys and sells, and a DBC swap only when the balance shows the side", () => {
    const launch = earlyBuyersFromHistory(launchlab("buy"), {
      mint: "coin-mint",
      venue: "launchlab",
      creator: "creator-wallet",
    });
    expect(launch).toMatchObject([{ wallet: "buyer-wallet", side: "buy", venue: "launchlab" }]);
    const sell = earlyBuyersFromHistory(launchlab("sell"), {
      mint: "coin-mint",
      venue: "launchlab",
      creator: "creator-wallet",
    });
    expect(sell[0]?.side).toBe("sell");
    const swap = earlyBuyersFromHistory(dbcSwap("1", "6"), {
      mint: "coin-mint",
      venue: "meteora",
      creator: "creator-wallet",
    });
    expect(swap).toMatchObject([{ wallet: "buyer-wallet", side: "buy", venue: "meteora" }]);
    expect(
      earlyBuyersFromHistory(dbcSwap(null, null), {
        mint: "coin-mint",
        venue: "meteora",
        creator: null,
      }),
    ).toEqual([]);
  });
});

describe("collectEarlyBuyers", () => {
  it("stops at the credit cap and does not repeat a finished mint", async () => {
    const fetchPage = vi.fn(async () => ({
      transactions: [launchlab("buy")],
      paginationToken: "more",
    }));
    const checkpoints: string[] = [];
    const first = await collectEarlyBuyers({
      mints: [target("coin-mint"), target("mint-b")],
      buysPerMint: 1,
      runCreditsLeft: 10,
      fetchPage,
      save: async () => undefined,
      checkpoint: async (row) => {
        checkpoints.push(`${row.mint}:${row.status}:${row.creditDelta}`);
      },
    });
    expect(first).toMatchObject({ credits: 10, mintsDone: 1, stopped: true });
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(checkpoints).toEqual(["coin-mint:done:10"]);

    fetchPage.mockClear();
    const second = await collectEarlyBuyers({
      mints: [{ ...target("coin-mint"), buysKept: 1, pages: 1 }],
      buysPerMint: 1,
      runCreditsLeft: 10,
      fetchPage,
      save: async () => undefined,
      checkpoint: async () => undefined,
    });
    expect(fetchPage).not.toHaveBeenCalled();
    expect(second.mintsDone).toBe(1);
    expect(second.credits).toBe(0);
  });

  it("does not checkpoint a mint when the history call fails", async () => {
    const checkpoint = vi.fn(async () => undefined);
    const result = await collectEarlyBuyers({
      mints: [target("mint-a")],
      buysPerMint: 50,
      runCreditsLeft: 30,
      fetchPage: async () => null,
      save: async () => undefined,
      checkpoint,
    });
    expect(result.stopped).toBe(true);
    expect(checkpoint).not.toHaveBeenCalled();
  });
});

function target(mint: string): BackfillTarget {
  return {
    mint,
    venue: "launchlab",
    account: "pool",
    creator: "creator-wallet",
    paginationToken: null,
    buysKept: 0,
    pages: 0,
  };
}

function pumpBuy(user: string): unknown {
  const keys = [
    "global",
    "fee",
    "coin-mint",
    "curve",
    "assoc-curve",
    "assoc-user",
    user,
    PUMP_PROGRAM_ID,
  ];
  return transaction(
    keys,
    [
      {
        programIdIndex: 7,
        accounts: [0, 1, 2, 3, 4, 5, 6],
        data: encodeBase58(Uint8Array.from(DISC.ixPumpBuy)),
      },
    ],
    [],
    [],
  );
}

function launchlab(side: "buy" | "sell"): unknown {
  const keys = [
    "buyer-wallet",
    "authority",
    "global",
    "platform",
    "pool",
    "user-base",
    "user-quote",
    "base-vault",
    "quote-vault",
    "coin-mint",
    "quote-mint",
    "base-program",
    "quote-program",
    "event",
    LAUNCHLAB_PROGRAM_ID,
  ];
  expect(keys[LAUNCHLAB_TRADE_ACCOUNTS.indexOf("payer")]).toBe("buyer-wallet");
  expect(keys[LAUNCHLAB_TRADE_ACCOUNTS.indexOf("base_token_mint")]).toBe("coin-mint");
  const disc = side === "buy" ? DISC.ixLaunchlabBuyExactIn : DISC.ixLaunchlabSellExactIn;
  return transaction(
    keys,
    [
      {
        programIdIndex: keys.length - 1,
        accounts: keys.map((_key, index) => index),
        data: encodeBase58(Uint8Array.from(disc)),
      },
    ],
    [],
    [],
  );
}

function dbcSwap(pre: string | null, post: string | null): unknown {
  const keys: string[] = DBC_SWAP_ACCOUNTS.map((name) => {
    if (name === "payer") return "buyer-wallet";
    if (name === "base_mint") return "coin-mint";
    return name;
  });
  keys.push(DBC_PROGRAM_ID);
  const preBalances =
    pre === null
      ? []
      : [{ owner: "buyer-wallet", mint: "coin-mint", uiTokenAmount: { amount: pre } }];
  const postBalances =
    post === null
      ? []
      : [{ owner: "buyer-wallet", mint: "coin-mint", uiTokenAmount: { amount: post } }];
  return transaction(
    keys,
    [
      {
        programIdIndex: keys.length - 1,
        accounts: DBC_SWAP_ACCOUNTS.map((_name, index) => index),
        data: encodeBase58(Uint8Array.from(DISC.ixDbcSwap)),
      },
    ],
    preBalances,
    postBalances,
  );
}

function transaction(
  accountKeys: string[],
  instructions: unknown[],
  preTokenBalances: unknown[],
  postTokenBalances: unknown[],
): unknown {
  return {
    slot: 9,
    transaction: {
      signatures: ["sig"],
      message: { accountKeys, instructions },
    },
    meta: { err: null, preTokenBalances, postTokenBalances },
  };
}
