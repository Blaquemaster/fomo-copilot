import { nextTransactionVersion } from "@fomo/core";

export class HeliusRpcError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null) {
    super(message);
    this.name = "HeliusRpcError";
    this.code = code;
  }
}

export type RpcMeter = (method: string) => void;

export async function heliusRpc(input: {
  apiKey: string;
  method: string;
  params: unknown[];
  fetchImpl?: typeof fetch;
  meter?: RpcMeter;
}): Promise<unknown> {
  input.meter?.(input.method);
  const url = `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(input.apiKey)}`;
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: input.method,
        params: input.params,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`helius ${input.method} request failed`);
  }
  if (!response.ok) {
    throw new Error(`helius ${input.method} HTTP ${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`helius ${input.method} returned invalid JSON`);
  }
  const record =
    typeof body === "object" && body !== null
      ? (body as { error?: { code?: number }; result?: unknown })
      : null;
  if (record?.error) {
    throw new HeliusRpcError(
      `helius ${input.method} rpc ${record.error.code ?? "error"}`,
      record.error.code ?? null,
    );
  }
  return record?.result;
}

export async function getTransaction(
  apiKey: string,
  signature: string,
  meter?: RpcMeter,
): Promise<unknown> {
  const config = (version: number) => ({
    encoding: "json",
    commitment: "confirmed",
    maxSupportedTransactionVersion: version,
  });
  try {
    return await heliusRpc({
      apiKey,
      method: "getTransaction",
      params: [signature, config(0)],
      meter,
    });
  } catch (error) {
    const retry = nextTransactionVersion(error instanceof HeliusRpcError ? error.code : null, 0);
    if (retry === null) throw error;
    return await heliusRpc({
      apiKey,
      method: "getTransaction",
      params: [signature, config(retry)],
      meter,
    });
  }
}

export async function getSlot(apiKey: string, meter?: RpcMeter): Promise<number | null> {
  const result = await heliusRpc({
    apiKey,
    method: "getSlot",
    params: [{ commitment: "confirmed" }],
    meter,
  });
  return typeof result === "number" ? result : null;
}

export function websocketUrl(apiKey: string): string {
  return `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}
