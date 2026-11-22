import { describe, expect, it } from "vitest";

import {
  SYSTEM_PROGRAM,
  createSlotSniperPct,
  loadTopHolders,
  walletTopHolderPct,
} from "./accounts.js";
import { byWalletPriority } from "./cycle.js";

const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

describe("wallet-only top 10", () => {
  it("leaves out the bonding curve vault and program-owned holders", () => {
    const pct = walletTopHolderPct(
      [
        { amount: 800n, owner: "Curve", ownerProgram: PUMP_PROGRAM },
        { amount: 50n, owner: "WalletA", ownerProgram: SYSTEM_PROGRAM },
        { amount: 30n, owner: "WalletB", ownerProgram: SYSTEM_PROGRAM },
        { amount: 20n, owner: "PoolAuthority", ownerProgram: null },
      ],
      1_000n,
    );
    expect(pct).toBe(8);
  });

  it("excludes a named curve owner even when it looks like a wallet", () => {
    const pct = walletTopHolderPct(
      [
        { amount: 900n, owner: "Curve", ownerProgram: SYSTEM_PROGRAM },
        { amount: 100n, owner: "WalletA", ownerProgram: SYSTEM_PROGRAM },
      ],
      1_000n,
      new Set(["Curve"]),
    );
    expect(pct).toBe(10);
  });

  it("reads owners over RPC and returns the wallet share", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
      calls.push(body.method);
      let result: unknown = null;
      if (body.method === "getTokenLargestAccounts") {
        result = {
          value: [
            { address: "VaultAta", amount: "800" },
            { address: "AtaA", amount: "60" },
            { address: "AtaB", amount: "40" },
          ],
        };
      } else if (body.method === "getMultipleAccounts") {
        const [keys] = body.params as [string[]];
        if (keys[0] === "VaultAta") {
          result = {
            value: ["CurveAcct", "WalletA", "WalletB"].map((owner) => ({
              data: { parsed: { info: { owner } } },
            })),
          };
        } else {
          result = {
            value: keys.map((key) => ({
              owner: key === "CurveAcct" ? PUMP_PROGRAM : SYSTEM_PROGRAM,
            })),
          };
        }
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }) as unknown as typeof fetch;
    const loaded = await loadTopHolders({
      apiKey: "test",
      mints: ["MintHolders1111111111111111111111111111111"],
      supplies: new Map([["MintHolders1111111111111111111111111111111", 1_000n]]),
      curves: new Map([["MintHolders1111111111111111111111111111111", "CurveAcct"]]),
      nowMs: Date.now(),
      fetchImpl,
    });
    expect(loaded.rows[0]?.top10Pct).toBe(10);
    expect(calls).toEqual([
      "getTokenLargestAccounts",
      "getMultipleAccounts",
      "getMultipleAccounts",
    ]);
    expect(loaded.credits).toBe(3);
  });
});

describe("create-slot snipers", () => {
  it("is unknown when the page did not reach the create slot", () => {
    const page = Array.from({ length: 20 }, (_row, index) => ({ slot: 500 - index }));
    expect(createSlotSniperPct(page, 100, 20)).toBeNull();
  });

  it("counts bundled buys once the create slot is in the page", () => {
    const page = [{ slot: 130 }, { slot: 120 }, { slot: 100 }, { slot: 100 }, { slot: 100 }];
    expect(createSlotSniperPct(page, 100)).toBeCloseTo(66.67, 1);
    expect(createSlotSniperPct([{ slot: 101 }, { slot: 100 }], 100)).toBe(0);
  });
});

describe("enrichment priority", () => {
  it("puts wallet-backed coins first, newest first within a tier", () => {
    const at = (minute: number) => new Date(Date.UTC(2026, 10, 22, 17, minute));
    const coins = [
      { mint: "a", trackedBuyers: 0, createdAt: at(10) },
      { mint: "b", trackedBuyers: 3, createdAt: at(1) },
      { mint: "c", trackedBuyers: 1, createdAt: at(5) },
      { mint: "d", trackedBuyers: 1, createdAt: at(8) },
    ];
    expect(coins.sort(byWalletPriority).map((coin) => coin.mint)).toEqual(["b", "d", "c", "a"]);
  });
});
