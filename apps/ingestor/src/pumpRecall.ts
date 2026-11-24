import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  LAUNCHLAB_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_PROGRAM_ID,
} from "@fomo/core";

import { diagnosticGateAllows } from "./helius.js";

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
export async function recallProgramFromPublicRpc(input: {
  programId: string;
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
  /** Diagnostic gate. A false result or a throw does not send the request. */
  gate?: () => Promise<boolean>;
}): Promise<PumpRecall> {
  if (input.gate && !(await diagnosticGateAllows(input.gate))) {
    return { checked: 0, missing: [], source: "public-rpc" };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(input.rpcUrl ?? PUBLIC_SOLANA_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [input.programId, { limit: input.limit ?? 20 }],
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

export function recallPumpFromPublicRpc(input: {
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
}): Promise<PumpRecall> {
  return recallProgramFromPublicRpc({ ...input, programId: PUMP_PROGRAM_ID });
}

/** PumpSwap. Not called from the live timer. */
export function recallPumpSwapFromPublicRpc(input: {
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
}): Promise<PumpRecall> {
  return recallProgramFromPublicRpc({ ...input, programId: PUMP_AMM_PROGRAM_ID });
}

/** LaunchLab. Not called from the live timer. */
export function recallLaunchLabFromPublicRpc(input: {
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
}): Promise<PumpRecall> {
  return recallProgramFromPublicRpc({ ...input, programId: LAUNCHLAB_PROGRAM_ID });
}

/** Meteora DBC and DAMM v2. Not called from the live timer. */
export async function recallMeteoraFromPublicRpc(input: {
  known: ReadonlySet<string>;
  fetchImpl?: typeof fetch;
  rpcUrl?: string;
  limit?: number;
}): Promise<PumpRecall> {
  const dbc = await recallProgramFromPublicRpc({ ...input, programId: DBC_PROGRAM_ID });
  const damm = await recallProgramFromPublicRpc({ ...input, programId: DAMM_V2_PROGRAM_ID });
  return {
    checked: dbc.checked + damm.checked,
    missing: [...dbc.missing, ...damm.missing],
    source: "public-rpc",
  };
}
