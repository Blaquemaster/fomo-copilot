import { describe, expect, it } from "vitest";

import { decodeBase58, encodeBase58 } from "@fomo/core";

import {
  DBC_BASE_VAULT_OFFSET,
  DBC_PROGRAM,
  DBC_QUOTE_VAULT_OFFSET,
  SYSTEM_PROGRAM,
  createSlotSniperPct,
  loadTopHolders,
  parseDbcVaults,
  walletTopHolderPct,
} from "./accounts.js";
import { byWalletPriority } from "./cycle.js";

function pubkey(fill: number): string {
  return encodeBase58(new Uint8Array(32).fill(fill));
}

function dbcPoolAccount(
  baseVault: string,
  quoteVault: string,
): { owner: string; data: [string, string] } {
  const raw = new Uint8Array(DBC_QUOTE_VAULT_OFFSET + 32);
  raw.set(decodeBase58(baseVault), DBC_BASE_VAULT_OFFSET);
  raw.set(decodeBase58(quoteVault), DBC_QUOTE_VAULT_OFFSET);
  return { owner: DBC_PROGRAM, data: [Buffer.from(raw).toString("base64"), "base64"] };
}

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
        const [keys, opts] = body.params as [string[], { encoding?: string; dataSlice?: unknown }];
        if (opts?.encoding === "jsonParsed") {
          result = {
            value: ["CurveAcct", "WalletA", "WalletB"].map((owner) => ({
              data: { parsed: { info: { owner } } },
            })),
          };
        } else if (opts?.dataSlice) {
          result = {
            value: keys.map((key) => ({
              owner: key === "CurveAcct" ? PUMP_PROGRAM : SYSTEM_PROGRAM,
            })),
          };
        } else {
          result = { value: [{ owner: PUMP_PROGRAM, data: ["", "base64"] }] };
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
      "getMultipleAccounts",
    ]);
    expect(loaded.credits).toBe(4);
  });
});

describe("DBC curve inventory", () => {
  it("reads base_vault and quote_vault from the virtual pool account", () => {
    const baseVault = pubkey(2);
    const quoteVault = pubkey(3);
    const parsed = parseDbcVaults(
      Uint8Array.from(Buffer.from(dbcPoolAccount(baseVault, quoteVault).data[0], "base64")),
    );
    expect(parsed).toEqual({ baseVault, quoteVault });
  });

  it("leaves the DBC inventory token account out of the top 10", async () => {
    const mint = "MintDbcVault111111111111111111111111111111";
    const pool = pubkey(9);
    const vaultAta = pubkey(2);
    const quoteAta = pubkey(3);
    const walletAta = "AtaWallet";
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { method: string; params: unknown[] };
      calls.push(body.method);
      let result: unknown = null;
      if (body.method === "getTokenLargestAccounts") {
        result = {
          value: [
            { address: vaultAta, amount: "900" },
            { address: walletAta, amount: "100" },
          ],
        };
      } else if (body.method === "getMultipleAccounts") {
        const [keys, opts] = body.params as [string[], { encoding?: string; dataSlice?: unknown }];
        if (opts?.encoding === "jsonParsed") {
          result = {
            value: keys.map((key) => ({
              data: { parsed: { info: { owner: key === vaultAta ? "InvWallet" : "WalletA" } } },
            })),
          };
        } else if (opts?.dataSlice) {
          result = { value: keys.map(() => ({ owner: SYSTEM_PROGRAM })) };
        } else {
          result = { value: [dbcPoolAccount(vaultAta, quoteAta)] };
        }
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }) as unknown as typeof fetch;
    const loaded = await loadTopHolders({
      apiKey: "test",
      mints: [mint],
      supplies: new Map([[mint, 1_000n]]),
      curves: new Map([[mint, pool]]),
      nowMs: Date.now(),
      fetchImpl,
    });
    expect(loaded.rows[0]?.top10Pct).toBe(10);
    expect(calls[0]).toBe("getTokenLargestAccounts");
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
