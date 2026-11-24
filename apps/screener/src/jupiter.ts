import {
  SOL_MINT,
  USDC_MINT,
  collectJupiterBids,
  jupiterQuoteUrl,
  jupiterRatePerMin,
  quoteUrlAllowed,
  takeTokens,
  type JupiterRequest,
  type TokenBucket,
} from "@fomo/core";

export { collectJupiterBids, type JupiterRequest };

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
