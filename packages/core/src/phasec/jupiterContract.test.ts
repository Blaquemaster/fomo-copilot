import { describe, expect, it } from "vitest";

import { JUPITER_QUOTE_URL, jupiterQuoteUrl, parseJupiterQuote } from "./quote.js";

/** Pinned shape of the current quote endpoint. Pool fees stay inside outAmount. */
const QUOTE_FIXTURE = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "Mint111111111111111111111111111111111111111",
  inAmount: "100000000",
  outAmount: "250000000",
  priceImpactPct: "0.01",
  routePlan: [{ swapInfo: { feeAmount: "0" } }],
};

describe("Jupiter quote contract", () => {
  it("pins the swap v1 quote URL and the fields the parser requires", () => {
    expect(JUPITER_QUOTE_URL).toBe("https://api.jup.ag/swap/v1/quote");
    const url = jupiterQuoteUrl(
      QUOTE_FIXTURE.inputMint,
      QUOTE_FIXTURE.outputMint,
      QUOTE_FIXTURE.inAmount,
    );
    expect(url.startsWith(`${JUPITER_QUOTE_URL}?`)).toBe(true);
    const parsed = parseJupiterQuote(QUOTE_FIXTURE, { sizeUsd: 20, side: "buy", solPriceUsd: 150 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.outAmount).toBe("250000000");
      expect(parsed.feeUsd).toBe(0);
    }
  });

  it("rejects a body that drops outAmount", () => {
    const broken = { ...QUOTE_FIXTURE, outAmount: "0" };
    expect(parseJupiterQuote(broken, 20).ok).toBe(false);
  });
});
