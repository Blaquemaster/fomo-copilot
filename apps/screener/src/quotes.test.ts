import { describe, expect, it, vi } from "vitest";

import { MIHAO_MINT } from "@fomo/core";

import { loadMarketQuotes, pollDue } from "./quotes.js";

describe("second-wave quotes", () => {
  it("uses the mihao fixture and does not call the network", async () => {
    const fetchImpl = vi.fn();
    const loaded = await loadMarketQuotes({ source: "fixture", mints: [], fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loaded.quotes.map((quote) => quote.mint)).toEqual([MIHAO_MINT]);
    expect(loaded.usage).toEqual({ dexRequests: 0, geckoRequests: 0, throttled: 0 });
  });

  it("polls DexScreener in batches and backs off on 429", async () => {
    const urls: string[] = [];
    let calls = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url);
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
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
    const loaded = await loadMarketQuotes({
      source: "live",
      mints: ["Mint111111111111111111111111111111111111"],
      fetchImpl: fetchImpl as unknown as typeof fetch,
      nowMs: 0,
    });
    expect(urls[0]).toBe(
      "https://api.dexscreener.com/latest/dex/tokens/Mint111111111111111111111111111111111111",
    );
    expect(urls.join(" ")).not.toMatch(/\/swap|\/execute|helius/i);
    expect(loaded.usage.throttled).toBe(1);
    expect(loaded.quotes[0]?.priceChange1hPct).toBe(25);
    expect(pollDue(null, 0, 10)).toBe(true);
    expect(pollDue(0, 9 * 60_000, 10)).toBe(false);
    expect(pollDue(0, 10 * 60_000, 10)).toBe(true);
  });
});
