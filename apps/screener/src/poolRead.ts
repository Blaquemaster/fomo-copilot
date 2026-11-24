import { tradabilityFromReserves, type PoolTradability } from "@fomo/core";

import { parseVenueCurve } from "./accounts.js";

/** Public Solana RPC. This check does not use Helius. */
export const PUBLIC_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export async function readPoolStates(input: {
  rows: readonly {
    mint: string;
    pool: string;
    poolType: string | null;
    sellAmountRaw: bigint;
  }[];
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
}): Promise<Record<string, PoolTradability>> {
  const out: Record<string, PoolTradability> = {};
  const fetchImpl = input.fetchImpl ?? fetch;
  const rpcUrl = input.rpcUrl ?? PUBLIC_SOLANA_RPC;
  for (const row of input.rows) {
    out[row.mint] = await readOne(fetchImpl, rpcUrl, row);
  }
  return out;
}

async function readOne(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  row: { pool: string; poolType: string | null; sellAmountRaw: bigint },
): Promise<PoolTradability> {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [row.pool, { encoding: "base64" }],
      }),
    });
    if (!response.ok) return "unknown";
    const body = (await response.json()) as {
      result?: { value?: { data?: [string, string] | string } | null };
    };
    const value = body.result?.value;
    if (!value)
      return tradabilityFromReserves({
        exists: false,
        virtualSolLamports: null,
        virtualTokenRaw: null,
        sellAmountRaw: row.sellAmountRaw,
      });
    const encoded = Array.isArray(value.data) ? value.data[0] : null;
    if (!encoded) return "unknown";
    const data = Buffer.from(encoded, "base64");
    const parsed = row.poolType ? parseVenueCurve(data, row.poolType) : null;
    return tradabilityFromReserves({
      exists: true,
      virtualSolLamports: parsed?.virtualSolLamports ?? null,
      virtualTokenRaw: parsed?.virtualTokenRaw ?? null,
      sellAmountRaw: row.sellAmountRaw,
    });
  } catch {
    return "unknown";
  }
}
