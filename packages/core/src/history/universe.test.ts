import { describe, expect, it } from "vitest";

import { UNIVERSE_CAP, admitMint } from "./universe.js";

describe("universe admission", () => {
  it("does not evict an open position or an experiment observation", () => {
    const full = Array.from({ length: UNIVERSE_CAP }, (_, index) => `mint-${index}`);
    const protectedMint = "mint-0";
    const result = admitMint({
      universe: full,
      mint: "mint-new",
      protectedMints: [protectedMint],
    });
    expect(result.admitted).toBe(true);
    expect(result.evicted).toBe("mint-1");
    expect(result.universe).toContain(protectedMint);
    expect(result.universe).toContain("mint-new");
    expect(result.universe).toHaveLength(UNIVERSE_CAP);
  });
});
