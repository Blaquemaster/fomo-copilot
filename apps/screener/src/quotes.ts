import {
  dexScreenerTokenUrl,
  geckoTerminalTokenUrl,
  mihaoFixtureQuote,
  parseDexScreener,
  parseGeckoTerminal,
  quoteUrlAllowed,
  type MarketQuote,
} from "@fomo/core";

/** DexScreener first, GeckoTerminal for mints it missed. Never Helius, swap, or execute. */
export async function loadMarketQuotes(input: {
  source: "live" | "fixture";
  mints: readonly string[];
  fetchImpl?: typeof fetch;
}): Promise<MarketQuote[]> {
  if (input.source !== "live") return [mihaoFixtureQuote()];
  const mints = input.mints.slice(0, 30);
  if (mints.length === 0) return [];
  const fetchImpl = input.fetchImpl ?? fetch;
  const quotes = new Map<string, MarketQuote>();
  const dexUrl = dexScreenerTokenUrl(mints);
  if (!quoteUrlAllowed(dexUrl)) return [];
  try {
    const response = await fetchImpl(dexUrl);
    if (response.ok) {
      for (const quote of parseDexScreener(await response.json())) quotes.set(quote.mint, quote);
    }
  } catch {
    // A quiet public endpoint is not a reason to stop exits already in progress.
  }
  for (const mint of mints) {
    if (quotes.has(mint)) continue;
    const geckoUrl = geckoTerminalTokenUrl(mint);
    if (!quoteUrlAllowed(geckoUrl)) continue;
    try {
      const response = await fetchImpl(geckoUrl);
      if (!response.ok) continue;
      const quote = parseGeckoTerminal(await response.json());
      if (quote) quotes.set(quote.mint, quote);
    } catch {
      // The next pass retries.
    }
  }
  return [...quotes.values()];
}
