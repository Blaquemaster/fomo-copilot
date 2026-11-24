import { quoteBackoffMs, quoteUrlAllowed, takeTokens, type TokenBucket } from "./market.js";
import {
  SOL_MINT,
  classifyJupiterHttp,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  parseJupiterQuote,
  quoteErrorBody,
  quoteKey,
  type QuotePurpose,
  type SizeBid,
} from "./quote.js";

export interface JupiterRequest {
  mint: string;
  side: "buy" | "sell";
  purpose: QuotePurpose;
  amount: string;
  which: "1x" | "2x";
  sizeUsd: number;
  solPriceUsd: number;
  priority: number;
}

async function gateAllows(gate: (() => Promise<boolean>) | undefined): Promise<boolean> {
  if (!gate) return true;
  try {
    return await gate();
  } catch {
    return false;
  }
}

/** Prefer text() so the raw body is kept. Test doubles often only implement json(). */
async function readQuoteBody(response: {
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}): Promise<string> {
  if (typeof response.text === "function") {
    try {
      return await response.text();
    } catch {
      return "";
    }
  }
  if (typeof response.json === "function") {
    try {
      return JSON.stringify(await response.json());
    } catch {
      return "";
    }
  }
  return "";
}

export async function collectJupiterBids(input: {
  requests: readonly JupiterRequest[];
  fetchImpl?: typeof fetch;
  bucket?: TokenBucket;
  nowMs?: number;
  apiKey?: string | null;
  sleep?: (ms: number) => Promise<void>;
  /** Unset uses https://api.jup.ag/swap/v1/quote. CI may point this at a mock. */
  quoteBase?: string;
  /**
   * Diagnostic gate. Called before every attempt, including a retry.
   * A false result or a throw does not send that attempt. The screener omits it.
   */
  gate?: () => Promise<boolean>;
}): Promise<{
  bids: Record<string, SizeBid>;
  bucket: TokenBucket;
  requests: number;
  throttled: number;
}> {
  const nowMs = input.nowMs ?? Date.now();
  const rate = jupiterRatePerMin(Boolean(input.apiKey));
  let bucket = input.bucket ?? { tokens: rate, refilledAt: nowMs };
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const bids: Record<string, SizeBid> = {};
  let requests = 0;
  let throttled = 0;
  const ordered = [...input.requests].sort((left, right) => left.priority - right.priority);
  for (const request of ordered) {
    const key = quoteKey(request.mint, request.purpose, request.which);
    const taken = takeTokens(bucket, nowMs, rate, 1);
    bucket = taken.bucket;
    if (taken.granted < 1) {
      bids[key] = { ok: false, reason: "rate_limited" };
      continue;
    }
    const inputMint = request.side === "buy" ? SOL_MINT : request.mint;
    const outputMint = request.side === "buy" ? request.mint : SOL_MINT;
    const url = jupiterQuoteUrl(inputMint, outputMint, request.amount, input.quoteBase);
    if (!quoteUrlAllowed(url, input.quoteBase)) {
      bids[key] = { ok: false, reason: "transient" };
      continue;
    }
    let outcome: SizeBid = { ok: false, reason: "transient" };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      if (!(await gateAllows(input.gate))) break;
      requests += 1;
      try {
        const response = await fetchImpl(url, {
          headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
        });
        const kind = classifyJupiterHttp(response.status);
        if (kind === "rate_limited") {
          throttled += 1;
          await sleep(quoteBackoffMs(attempt));
          continue;
        }
        if (kind === "transient") {
          await sleep(quoteBackoffMs(attempt));
          continue;
        }
        const raw = await readQuoteBody(response);
        if (kind !== "ok") {
          outcome = {
            ok: false,
            reason: kind,
            httpStatus: response.status,
            errorBody: quoteErrorBody(raw),
          };
          break;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          outcome = {
            ok: false,
            reason: "transient",
            httpStatus: response.status,
            errorBody: quoteErrorBody(raw),
          };
          break;
        }
        const quote = parseJupiterQuote(parsed, {
          sizeUsd: request.sizeUsd,
          side: request.side,
          solPriceUsd: request.solPriceUsd,
        });
        outcome = quote.ok
          ? quote
          : { ...quote, httpStatus: response.status, errorBody: quoteErrorBody(raw) };
        break;
      } catch {
        outcome = { ok: false, reason: "transient" };
        await sleep(quoteBackoffMs(attempt));
      }
    }
    bids[key] = outcome;
  }
  return { bids, bucket, requests, throttled };
}
