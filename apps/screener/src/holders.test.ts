import { describe, expect, it } from "vitest";

import { decodeBase58, encodeBase58 } from "@fomo/core";

import {
  DBC_BASE_VAULT_OFFSET,
  DBC_PROGRAM,
  DBC_QUOTE_VAULT_OFFSET,
  SYSTEM_PROGRAM,
  createSlotSniperPct,
  loadCreateSlotSnipers,
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

  it("stays unknown when pagination hits the cap before the create slot", () => {
    const pages = Array.from({ length: 5000 }, (_row, index) => ({ slot: 10_000 - index }));
    expect(createSlotSniperPct(pages, 100, 1000, true)).toBeNull();
  });
});

const REAL = {
  pump: {
    mint: "pump-mint",
    pool: "pump-curve",
    signature:
      "4zKozQVM5gcomgiXnMAP7uFLUftm47PSRDomWDDZf8VqJG3D9R8mJF9CQHvhR7jCZW6fKNNprpdnuvoGUmoXFuib",
    slot: 470510493,
  },
  launchlab: {
    mint: "lab-mint",
    pool: "lab-pool-state",
    signature:
      "EFFtomNYquorwPfETGJEGKALaGxaefYGG9LLLGUP2J8G1Jqz3rQqyvpJ8pEDq84EjyCtugmB3HNx9khbzkJsLZb",
    slot: 470821705,
  },
  dbc: {
    mint: "9V1axz9mB2X45pUXCP9iYBVGsegU643eqvnJkuC2936x",
    pool: "4M3t9sK7LxgNswQJsWVr9RArw3pkrGgt5hay4D84CPX4",
    signature:
      "4QpMmMWTjX4UtwBTV1JsE5J8yeFtBKsfhSLh98fcJeuVqwdcGNRNGGmTdkPAiV3uLeFaXkpxNw4SrxcJprhkM73h",
    slot: 468993762,
  },
  graduated: {
    mint: "8tihoKEgDJH7ToKHvFuXiwvTm1yaHXv26NxR7s6QhC7B",
    pool: "F1BD8nH8agz2i9Yf3To8t4yNpxBBmRgfo2vyXabd9QUJ",
    signature:
      "4ZJje3fpvsMMFXw7FbBSaS4AqPSNM2FoXBnGu4f58R8hiC8Lx4EGTvWcW2X3FzVkQbVqaWVTqBDB4pSJFRV9hpUM",
    slot: 472942916,
  },
} as const;

function signatureFetch(pages: Map<string, Array<Array<{ signature: string; slot: number }>>>) {
  return (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as {
      method: string;
      params: [string, { limit?: number; before?: string }];
    };
    if (body.method !== "getSignaturesForAddress") {
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    }
    const [address, opts] = body.params;
    const booked = pages.get(address) ?? [];
    let page = booked[0] ?? [];
    if (opts?.before) {
      const previous = booked.findIndex((candidate) => candidate.at(-1)?.signature === opts.before);
      page = previous >= 0 ? (booked[previous + 1] ?? []) : [];
    }
    return new Response(JSON.stringify({ result: page }), { status: 200 });
  }) as unknown as typeof fetch;
}

describe("venue sniper scans from real transactions", () => {
  it("measures pump, launchlab, dbc, and a graduated DBC origin pool", async () => {
    const pages = new Map<string, Array<Array<{ signature: string; slot: number }>>>();
    // Three create-slot signatures: create plus two snipers -> 66.67%.
    for (const venue of Object.values(REAL)) {
      pages.set(venue.pool, [
        [
          { signature: `${venue.signature}-s2`, slot: venue.slot },
          { signature: `${venue.signature}-s1`, slot: venue.slot },
          { signature: venue.signature, slot: venue.slot },
        ],
      ]);
    }
    const loaded = await loadCreateSlotSnipers({
      apiKey: "test",
      coins: Object.values(REAL).map((venue) => ({
        mint: venue.mint,
        bondingCurve: venue.pool,
        createdSlot: venue.slot,
      })),
      fetchImpl: signatureFetch(pages),
    });
    expect(loaded.rows).toHaveLength(4);
    expect(loaded.credits).toBe(4);
    for (const row of loaded.rows) {
      expect(row.sniperPct).toBeCloseTo(66.67, 1);
    }
  });

  it("paginates past 1000 signatures until the real create slot", async () => {
    const venue = REAL.launchlab;
    const first = Array.from({ length: 1000 }, (_row, index) => ({
      signature: `newer-${index.toString()}`,
      slot: venue.slot + 1000 - index,
    }));
    const second = [
      { signature: `${venue.signature}-s1`, slot: venue.slot },
      { signature: venue.signature, slot: venue.slot },
    ];
    const pages = new Map([[venue.pool, [first, second]]]);
    const loaded = await loadCreateSlotSnipers({
      apiKey: "test",
      coins: [{ mint: venue.mint, bondingCurve: venue.pool, createdSlot: venue.slot }],
      fetchImpl: signatureFetch(pages),
      pageSize: 1000,
      maxPages: 5,
    });
    expect(loaded.credits).toBe(2);
    expect(loaded.rows[0]?.sniperPct).toBe(50);
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
