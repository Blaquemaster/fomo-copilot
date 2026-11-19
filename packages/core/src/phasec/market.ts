/** Free quote hosts only. Swap, execute, order, and Helius URLs are refused. */

const ALLOWED = [
  /^https:\/\/api\.dexscreener\.com\/latest\/dex\/tokens\/[1-9A-HJ-NP-Za-km-z,]+$/,
  /^https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/solana\/tokens\/[1-9A-HJ-NP-Za-km-z]+$/,
];

export interface MarketQuote {
  mint: string;
  priceUsd: number;
  liquidityUsd: number | null;
  volumeUsd1h: number | null;
  priceChange1hPct: number | null;
  source: "dexscreener" | "geckoterminal" | "fixture";
}

export function quoteUrlAllowed(url: string): boolean {
  if (/swap|execute|order|helius/i.test(url)) return false;
  return ALLOWED.some((pattern) => pattern.test(url));
}

export function dexScreenerTokenUrl(mints: readonly string[]): string {
  return `https://api.dexscreener.com/latest/dex/tokens/${mints.join(",")}`;
}

export function geckoTerminalTokenUrl(mint: string): string {
  return `https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}`;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseDexScreener(body: unknown): MarketQuote[] {
  if (!body || typeof body !== "object" || !("pairs" in body) || !Array.isArray(body.pairs)) {
    return [];
  }
  const best = new Map<string, MarketQuote>();
  for (const pair of body.pairs) {
    if (!pair || typeof pair !== "object") continue;
    const record = pair as Record<string, unknown>;
    const base = record["baseToken"];
    const mint =
      base && typeof base === "object" && "address" in base && typeof base.address === "string"
        ? base.address
        : null;
    const price = num(record["priceUsd"]);
    if (!mint || price === null || price <= 0) continue;
    const liquidity = record["liquidity"];
    const volume = record["volume"];
    const change = record["priceChange"];
    const quote: MarketQuote = {
      mint,
      priceUsd: price,
      liquidityUsd:
        liquidity && typeof liquidity === "object"
          ? num((liquidity as { usd?: unknown }).usd)
          : null,
      volumeUsd1h:
        volume && typeof volume === "object" ? num((volume as { h1?: unknown }).h1) : null,
      priceChange1hPct:
        change && typeof change === "object" ? num((change as { h1?: unknown }).h1) : null,
      source: "dexscreener",
    };
    const previous = best.get(mint);
    if (!previous || (quote.liquidityUsd ?? 0) > (previous.liquidityUsd ?? 0))
      best.set(mint, quote);
  }
  return [...best.values()];
}

export function parseGeckoTerminal(body: unknown): MarketQuote | null {
  if (!body || typeof body !== "object" || !("data" in body)) return null;
  const data = body.data;
  if (!data || typeof data !== "object" || !("attributes" in data)) return null;
  const attributes = data.attributes;
  if (!attributes || typeof attributes !== "object") return null;
  const record = attributes as Record<string, unknown>;
  const mint = typeof record["address"] === "string" ? record["address"] : null;
  const price = num(record["price_usd"]);
  if (!mint || price === null || price <= 0) return null;
  const volume = record["volume_usd"];
  return {
    mint,
    priceUsd: price,
    liquidityUsd: num(record["reserve_in_usd"]),
    volumeUsd1h: volume && typeof volume === "object" ? num((volume as { h1?: unknown }).h1) : null,
    priceChange1hPct: null,
    source: "geckoterminal",
  };
}

/** Offline second-wave sample. A graduated coin up 40% in the last hour. */
export const MIHAO_MINT = "Mihao111111111111111111111111111111111111";

export function mihaoFixtureQuote(): MarketQuote {
  const parsed = parseDexScreener({
    pairs: [
      {
        baseToken: { address: MIHAO_MINT, symbol: "MIHAO" },
        priceUsd: "0.0042",
        liquidity: { usd: 42000 },
        volume: { h1: 18000 },
        priceChange: { h1: 40 },
      },
    ],
  });
  const quote = parsed[0];
  if (!quote) throw new Error("mihao fixture did not parse");
  return { ...quote, source: "fixture" };
}
