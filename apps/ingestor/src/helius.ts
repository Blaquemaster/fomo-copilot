import { nextTransactionVersion, parsedScanCredits } from "@fomo/core";

export class HeliusRpcError extends Error {
  readonly code: number | null;

  constructor(message: string, code: number | null) {
    super(message);
    this.name = "HeliusRpcError";
    this.code = code;
  }
}

export type RpcMeter = (method: string) => void;

/** A throwing or refusing diagnostic gate must not be followed by a request. */
export async function diagnosticGateAllows(gate: () => Promise<boolean>): Promise<boolean> {
  try {
    return await gate();
  } catch {
    return false;
  }
}

export async function heliusRpc(input: {
  apiKey: string;
  method: string;
  params: unknown[];
  fetchImpl?: typeof fetch;
  meter?: RpcMeter;
  /** Default is the public Helius host. CI sets a mock origin. */
  baseUrl?: string;
}): Promise<unknown> {
  input.meter?.(input.method);
  const root = (input.baseUrl ?? "https://mainnet.helius-rpc.com").replace(/\/$/, "");
  const url = `${root}/?api-key=${encodeURIComponent(input.apiKey)}`;
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
  baseUrl?: string,
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
      baseUrl,
    });
  } catch (error) {
    const retry = nextTransactionVersion(error instanceof HeliusRpcError ? error.code : null, 0);
    if (retry === null) throw error;
    return await heliusRpc({
      apiKey,
      method: "getTransaction",
      params: [signature, config(retry)],
      meter,
      baseUrl,
    });
  }
}

export async function getSlot(
  apiKey: string,
  meter?: RpcMeter,
  baseUrl?: string,
): Promise<number | null> {
  const result = await heliusRpc({
    apiKey,
    method: "getSlot",
    params: [{ commitment: "confirmed" }],
    meter,
    baseUrl,
  });
  return typeof result === "number" ? result : null;
}

export function websocketUrl(apiKey: string): string {
  return `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}

export interface ScanMatch {
  signature: string;
  slot: number;
}

/**
 * Parsed Events scan. Filters one program's history to instruction names and a slot window.
 * https://www.helius.dev/docs/api-reference/parsed-events/scan
 * Cost is creditsCharged on the response (10 per request plus 1 per 1,000-transaction page).
 */
export async function scanInstructionHistory(input: {
  apiKey: string;
  programId: string;
  instructionNames: readonly string[];
  slotGt: number;
  slotLte: number | null;
  /** Requests of up to 10,000 transactions. Startup backfill uses 4. */
  maxPages?: number;
  /** Charged history pages for this HTTP call. Diagnostic passes 1 for a 1,000-transaction budget. */
  maxScannedTransactions?: number;
  /**
   * Diagnostic gate. Called before every page, including a continued page.
   * A false result or a throw does not send the request. The ingestor omits it.
   */
  gate?: (input: { historyPages: number }) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}): Promise<{ matches: ScanMatch[]; creditsCharged: number; complete: boolean }> {
  const matches: ScanMatch[] = [];
  let creditsCharged = 0;
  let paginationToken: string | undefined;
  let complete = false;
  const maxPages = input.maxPages ?? 4;
  const maxScanned = input.maxScannedTransactions ?? 10_000;
  const historyPages = Math.max(1, Math.ceil(maxScanned / 1000));
  for (let page = 0; page < maxPages; page += 1) {
    if (
      !(await diagnosticGateAllows(() => input.gate?.({ historyPages }) ?? Promise.resolve(true)))
    ) {
      break;
    }
    const slot: Record<string, number> = { gt: input.slotGt };
    if (input.slotLte !== null) slot["lte"] = input.slotLte;
    const body: Record<string, unknown> = {
      address: input.programId,
      match: {
        programs: [
          {
            programId: input.programId,
            instructions: [...input.instructionNames],
            scope: "transaction",
          },
        ],
      },
      returnShape: "signatures",
      sortOrder: "desc",
      commitment: "confirmed",
      slot,
      budget: { maxScannedTransactions: maxScanned },
    };
    if (paginationToken) body["paginationToken"] = paginationToken;
    const root = (input.baseUrl ?? "https://mainnet.helius-rpc.com").replace(/\/$/, "");
    const url = `${root}/v1/parsed-events/scan?api-key=${encodeURIComponent(input.apiKey)}`;
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error("helius parsed-events scan request failed");
    }
    if (!response.ok) {
      throw new Error(`helius parsed-events scan HTTP ${response.status}`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("helius parsed-events scan returned invalid JSON");
    }
    const record =
      typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {};
    if (typeof record["error"] === "string") {
      throw new Error("helius parsed-events scan rejected the filter");
    }
    const scan =
      typeof record["scan"] === "object" && record["scan"] !== null
        ? (record["scan"] as Record<string, unknown>)
        : {};
    const scanned =
      typeof scan["scannedTransactions"] === "number" ? scan["scannedTransactions"] : 0;
    creditsCharged +=
      typeof scan["creditsCharged"] === "number"
        ? scan["creditsCharged"]
        : parsedScanCredits(scanned);
    const data = Array.isArray(record["data"]) ? record["data"] : [];
    for (const row of data) {
      if (typeof row !== "object" || row === null) continue;
      const item = row as { signature?: unknown; slot?: unknown };
      if (typeof item.signature === "string" && typeof item.slot === "number") {
        matches.push({ signature: item.signature, slot: item.slot });
      }
    }
    const stopped = typeof scan["stoppedOn"] === "string" ? scan["stoppedOn"] : "";
    const through =
      typeof scan["scannedThrough"] === "object" && scan["scannedThrough"] !== null
        ? (scan["scannedThrough"] as { slot?: unknown }).slot
        : undefined;
    paginationToken =
      typeof record["paginationToken"] === "string" ? record["paginationToken"] : undefined;
    const covered =
      stopped === "windowEnd" ||
      (typeof through === "number" && through <= input.slotGt) ||
      paginationToken === undefined;
    if (covered) {
      complete = true;
      break;
    }
  }
  if (!complete && paginationToken === undefined) complete = true;
  return { matches, creditsCharged, complete };
}
