import { describe, expect, it, vi } from "vitest";

import { MIHAO_MINT } from "@fomo/core";

import { loadMarketQuotes } from "./quotes.js";

describe("second-wave quotes", () => {
  it("uses the mihao fixture and does not call the network", async () => {
    const fetchImpl = vi.fn();
    const quotes = await loadMarketQuotes({ source: "fixture", mints: [], fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(quotes.map((quote) => quote.mint)).toEqual([MIHAO_MINT]);
  });

  it("polls DexScreener and not a swap or execute endpoint", async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          pairs: [
            {
              baseToken: { address: "Mint111111111111111111111111111111111111" },
              priceUsd: "1",
              liquidity: { usd: 1000 },
              volume: { h1: 10 },
              priceChange: { h1: 25 },
            },
          ],
        }),
      };
    });
    const quotes = await loadMarketQuotes({
      source: "live",
      mints: ["Mint111111111111111111111111111111111111"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(urls).toEqual([
      "https://api.dexscreener.com/latest/dex/tokens/Mint111111111111111111111111111111111111",
    ]);
    expect(urls.join(" ")).not.toMatch(/swap|execute|helius/i);
    expect(quotes[0]?.priceChange1hPct).toBe(25);
  });
});
