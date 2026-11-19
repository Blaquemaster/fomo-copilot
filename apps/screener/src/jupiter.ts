import {
  SOL_MINT,
  USDC_MINT,
  classifyJupiterHttp,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  parseJupiterQuote,
  quoteBackoffMs,
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
}): Promise<number | null> {
  const nowMs = input.nowMs ?? Date.now();
  if (solPriceCache && nowMs - solPriceCache.at < 60_000) return solPriceCache.price;
  const url = jupiterQuoteUrl(SOL_MINT, USDC_MINT, "1000000000");
  if (!quoteUrlAllowed(url)) return null;
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      headers: input.apiKey ? { "x-api-key": input.apiKey } : {},
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { outAmount?: string };
    const usd = Number(body.outAmount) / 1_000_000;
    if (!(usd > 0)) return null;
    solPriceCache = { price: usd, at: nowMs };
    return usd;
  } catch {
    return solPriceCache?.price ?? null;
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
        if (kind === "no_route") {
          outcome = { ok: false, reason: "no_route" };
          break;
        }
        const body = await response.json();
        outcome = parseJupiterQuote(body, {
          sizeUsd: request.sizeUsd,
          side: request.side,
          solPriceUsd: request.solPriceUsd,
        });
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
