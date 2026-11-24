import { describe, expect, it } from "vitest";

import { PUBLIC_SOLANA_RPC, recallPumpFromPublicRpc } from "./pumpRecall.js";

describe("pump public recall", () => {
  it("uses the public RPC and reports a signature that was not stored", async () => {
    const urls: string[] = [];
    const report = await recallPumpFromPublicRpc({
      known: new Set(["kept"]),
      rpcUrl: PUBLIC_SOLANA_RPC,
      fetchImpl: (async (url: string) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: [{ signature: "kept" }, { signature: "missing" }] }),
        };
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual([PUBLIC_SOLANA_RPC]);
    expect(urls.join(" ")).not.toMatch(/helius/i);
    expect(report).toEqual({ checked: 2, missing: ["missing"], source: "public-rpc" });
  });
});
