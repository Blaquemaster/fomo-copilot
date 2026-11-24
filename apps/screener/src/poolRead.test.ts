import { describe, expect, it } from "vitest";

import { readPoolStates } from "./poolRead.js";

describe("direct pool read", () => {
  it("treats a missing account as closed and does not call Helius", async () => {
    const urls: string[] = [];
    const states = await readPoolStates({
      rows: [
        {
          mint: "Mint111111111111111111111111111111111111",
          pool: "Pool111111111111111111111111111111111111",
          poolType: "pump",
          sellAmountRaw: 1n,
        },
      ],
      rpcUrl: "https://api.mainnet-beta.solana.com",
      fetchImpl: (async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          json: async () => ({ result: { value: null } }),
        };
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual(["https://api.mainnet-beta.solana.com"]);
    expect(urls.join(" ")).not.toMatch(/helius/i);
    expect(states["Mint111111111111111111111111111111111111"]).toBe("closed");
  });
});
