import {
  SOL_MINT,
  USDC_MINT,
  classifyJupiterHttp,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  parseJupiterQuote,
  quoteBackoffMs,
  quoteErrorBody,
  quoteKey,
  quoteUrlAllowed,
  takeTokens,
  type QuotePurpose,
  type SizeBid,
  type TokenBucket,
} from "@fomo/core";

let solPriceCache: { price: number; at: number } | null = null;

/** One SOL quoted into USDC. Cached for about a minute. */
export async function fetchSolPriceUsd(input: {
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
  nowMs?: number;
  bucket?: TokenBucket;
}): Promise<{ price: number | null; bucket: TokenBucket }> {
  const nowMs = input.nowMs ?? Date.now();
  const rate = jupiterRatePerMin(Boolean(input.apiKey));
  let bucket = input.bucket ?? { tokens: rate, refilledAt: nowMs };
  if (solPriceCache && nowMs - solPriceCache.at < 60_000) {
    return { price: solPriceCache.price, bucket };
  }
  const taken = takeTokens(bucket, nowMs, rate, 1);
  bucket = taken.bucket;
  if (taken.granted < 1) return { price: solPriceCache?.price ?? null, bucket };
  const url = jupiterQuoteUrl(SOL_MINT, USDC_MINT, "1000000000");
  if (!quoteUrlAllowed(url)) return { price: null, bucket };
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
    });
    if (!response.ok) return { price: solPriceCache?.price ?? null, bucket };
    const body = (await response.json()) as { outAmount?: string };
    const usd = Number(body.outAmount) / 1_000_000;
    if (!(usd > 0)) return { price: null, bucket };
    solPriceCache = { price: usd, at: nowMs };
    return { price: usd, bucket };
  } catch {
    return { price: solPriceCache?.price ?? null, bucket };
  }
}

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

export async function collectJupiterBids(input: {
  requests: readonly JupiterRequest[];
  fetchImpl?: typeof fetch;
  bucket?: TokenBucket;
  nowMs?: number;
  apiKey?: string | null;
  sleep?: (ms: number) => Promise<void>;
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
    const url = jupiterQuoteUrl(inputMint, outputMint, request.amount);
    if (!quoteUrlAllowed(url)) {
      bids[key] = { ok: false, reason: "transient" };
      continue;
    }
    let outcome: SizeBid = { ok: false, reason: "transient" };
    for (let attempt = 1; attempt <= 4; attempt += 1) {
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
