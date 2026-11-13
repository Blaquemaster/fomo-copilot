export async function heliusRpc(input: {
  apiKey: string;
  method: string;
  params: unknown[];
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
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
    throw new Error(`helius ${input.method} rpc ${record.error.code ?? "error"}`);
  }
  return record?.result;
}

export function websocketUrl(apiKey: string): string {
  return `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}
