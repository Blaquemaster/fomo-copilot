import { PUMP_PROGRAM_ID } from "@fomo/core";

/** Public Solana JSON-RPC. This recall does not call Helius. */
export const PUBLIC_SOLANA_RPC = "https://api.mainnet-beta.solana.com";

export interface PumpRecall {
  checked: number;
  missing: string[];
  source: "public-rpc";
}

/**
 * Compare recent Pump.fun program signatures from the public Solana RPC with signatures
 * already stored. Missing signatures are the recall misses. Helius is not used.
 */
export async function recallPumpFromPublicRpc(input: {
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
}): Promise<PumpRecall> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.rpcUrl ?? PUBLIC_SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [PUMP_PROGRAM_ID, { limit: input.limit ?? 20 }],
    }),
  });
  if (!response.ok) throw new Error(`public rpc status ${response.status.toString()}`);
  const body = (await response.json()) as { result?: Array<{ signature?: string }> };
  const signatures = (body.result ?? [])
    .map((row) => row.signature)
    .filter((signature): signature is string => typeof signature === "string");
  return {
    checked: signatures.length,
    missing: signatures.filter((signature) => !input.known.has(signature)),
    source: "public-rpc",
  };
}
