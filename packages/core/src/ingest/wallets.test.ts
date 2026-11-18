import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MICROS_PER_CREDIT, PLAN_CREDITS } from "./budget.js";
import {
  LAUNCHLAB_PROGRAM_ID,
  PUMP_PROGRAM_ID,
  WALLET_SUB_CHUNK,
  WALLET_TRADE_NAMES,
} from "./programs.js";
import {
  chunkWallets,
  scoreProvenWallets,
  walletBudgetOpen,
  walletCreditCapMicros,
  walletFillsFromParsed,
  type EarlyBuy,
} from "./wallets.js";

const graduated = (wallet: string, mint: string, side: "buy" | "sell"): EarlyBuy => ({
  wallet,
  mint,
  side,
  graduated: true,
});

describe("proven wallets", () => {
  it("keeps wallets with early wins and drops sellers and one-off buyers", () => {
    const scored = scoreProvenWallets(
      [
        graduated("winner", "mint-a", "buy"),
        graduated("winner", "mint-b", "buy"),
        graduated("seller", "mint-a", "buy"),
        graduated("seller", "mint-a", "sell"),
        graduated("seller", "mint-b", "buy"),
        graduated("seller", "mint-b", "sell"),
        graduated("once", "mint-a", "buy"),
        { wallet: "miss", mint: "mint-c", side: "buy", graduated: false },
        { wallet: "miss", mint: "mint-d", side: "buy", graduated: false },
      ],
      300,
    );
    expect(scored.map((row) => row.address)).toEqual(["winner"]);
    expect(scored[0]).toMatchObject({ earlyEntries: 2, earlyWins: 2, hitRate: 1 });
    expect(scored[0]?.derivation).toContain("funding source unknown");
    expect(JSON.stringify(scored)).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  });

  it("ranks by hit rate, then wins, then address, and stops at the cap", () => {
    const rows: EarlyBuy[] = [];
    for (const wallet of ["b-wallet", "a-wallet", "c-wallet"]) {
      rows.push(graduated(wallet, `${wallet}-1`, "buy"), graduated(wallet, `${wallet}-2`, "buy"));
    }
    rows.push(
      { wallet: "b-wallet", mint: "b-wallet-3", side: "buy", graduated: false },
      graduated("c-wallet", "c-wallet-3", "buy"),
    );
    const scored = scoreProvenWallets(rows, 2);
    expect(scored.map((row) => row.address)).toEqual(["c-wallet", "a-wallet"]);
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
    const developer = walletCreditCapMicros(PLAN_CREDITS.developer * MICROS_PER_CREDIT, 25);
    const free = walletCreditCapMicros(PLAN_CREDITS.free * MICROS_PER_CREDIT, 25);
    expect(developer / MICROS_PER_CREDIT).toBe(2_500_000n);
    expect(free / MICROS_PER_CREDIT).toBe(250_000n);
    expect(walletBudgetOpen(developer - 1n, developer)).toBe(true);
    expect(walletBudgetOpen(developer, developer)).toBe(false);
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
