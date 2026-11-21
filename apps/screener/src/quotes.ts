import {
  DEX_BATCH,
  DEX_REQUESTS_PER_MIN,
  GECKO_REQUESTS_PER_MIN,
  dexScreenerTokenUrl,
  geckoTerminalTokenUrl,
  mihaoFixtureQuote,
  parseDexScreener,
  parseGeckoTerminal,
  quoteBackoffMs,
  quoteUrlAllowed,
  takeTokens,
  type MarketQuote,
  type TokenBucket,
} from "@fomo/core";

export interface QuoteUsage {
  dexRequests: number;
  geckoRequests: number;
  throttled: number;
}

export function freshBucket(nowMs: number): TokenBucket {
  return { tokens: 0, refilledAt: nowMs };
}

export function pollDue(lastPollAt: number | null, nowMs: number, intervalMin: number): boolean {
  if (lastPollAt === null) return true;
  return nowMs - lastPollAt >= intervalMin * 60_000;
}

async function fetchQuote(
  fetchImpl: typeof fetch,
  url: string,
  usage: QuoteUsage,
  host: "dex" | "gecko",
): Promise<unknown | null> {
  if (!quoteUrlAllowed(url)) return null;
  let attempt = 1;
  const maxAttempts = host === "gecko" ? 2 : 4;
  while (attempt <= maxAttempts) {
    const response = await fetchImpl(url);
    if (host === "dex") usage.dexRequests += 1;
    else usage.geckoRequests += 1;
    if (response.status === 429) {
      usage.throttled += 1;
      await new Promise((resolve) => setTimeout(resolve, quoteBackoffMs(attempt)));
      attempt += 1;
      continue;
    }
    if (!response.ok) return null;
    return response.json();
  }
  return null;
}

/** DexScreener batches, then at most one Gecko minute of misses. Never Helius, swap, or execute. */
export async function loadMarketQuotes(input: {
  source: "live" | "fixture";
  mints: readonly string[];
  fetchImpl?: typeof fetch;
  nowMs?: number;
  dexBucket?: TokenBucket;
  geckoBucket?: TokenBucket;
}): Promise<{
  quotes: MarketQuote[];
  usage: QuoteUsage;
  dexBucket: TokenBucket;
  geckoBucket: TokenBucket;
}> {
  const nowMs = input.nowMs ?? Date.now();
  const usage: QuoteUsage = { dexRequests: 0, geckoRequests: 0, throttled: 0 };
  let dexBucket = input.dexBucket ?? { tokens: DEX_REQUESTS_PER_MIN, refilledAt: nowMs };
  let geckoBucket = input.geckoBucket ?? { tokens: GECKO_REQUESTS_PER_MIN, refilledAt: nowMs };
  if (input.source !== "live") {
    return { quotes: [mihaoFixtureQuote()], usage, dexBucket, geckoBucket };
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const quotes = new Map<string, MarketQuote>();
  for (let index = 0; index < input.mints.length; index += DEX_BATCH) {
    const taken = takeTokens(dexBucket, nowMs, DEX_REQUESTS_PER_MIN, 1);
    dexBucket = taken.bucket;
    if (taken.granted < 1) break;
    const batch = input.mints.slice(index, index + DEX_BATCH);
    const body = await fetchQuote(fetchImpl, dexScreenerTokenUrl(batch), usage, "dex");
    if (!body) continue;
    for (const quote of parseDexScreener(body)) quotes.set(quote.mint, quote);
  }
  const missing = input.mints.filter((mint) => !quotes.has(mint));
  for (const mint of missing) {
    const taken = takeTokens(geckoBucket, nowMs, GECKO_REQUESTS_PER_MIN, 1);
    geckoBucket = taken.bucket;
    if (taken.granted < 1) break;
    const body = await fetchQuote(fetchImpl, geckoTerminalTokenUrl(mint), usage, "gecko");
    const quote = body ? parseGeckoTerminal(body) : null;
    if (quote) quotes.set(quote.mint, quote);
  }
  return { quotes: [...quotes.values()], usage, dexBucket, geckoBucket };
}
