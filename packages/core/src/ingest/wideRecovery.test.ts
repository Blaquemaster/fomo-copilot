import { describe, expect, it } from "vitest";

import { fetchSignaturePage, walkSignatureGap } from "./wideRecovery.js";

describe("wide recovery", () => {
  it("pages the public RPC and does not call Helius", async () => {
    const urls: string[] = [];
    const rows = await fetchSignaturePage({
      programId: "prog",
      before: null,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      fetchImpl: (async (url: string) => {
        urls.push(String(url));
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: [{ signature: "sig", slot: 10 }] }),
        };
      }) as unknown as typeof fetch,
    });
    expect(urls).toEqual(["https://api.mainnet-beta.solana.com"]);
    expect(urls.join(" ")).not.toMatch(/helius/i);
    expect(rows).toEqual([{ signature: "sig", slot: 10 }]);
  });

  it("stops inside the slot bound and stamps recovery completion on that page only", async () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    const pages = [
      [
        { signature: "new", slot: 5_000 },
        { signature: "mid", slot: 4_000 },
      ],
      [{ signature: "old", slot: 100 }],
    ];
    const walked = await walkSignatureGap({
      programId: "prog",
      fromSlot: 200,
      toSlot: 5_000,
      now,
      fetchPage: async () => pages.shift() ?? [],
    });
    expect(walked.finished).toBe(true);
    expect(walked.checkpoints).toHaveLength(2);
    expect(walked.checkpoints[0]?.recoveryCompletedAt).toBeNull();
    expect(walked.checkpoints[1]?.recoveryCompletedAt?.toISOString()).toBe(now.toISOString());
    expect(walked.signatures.map((row) => row.signature)).toEqual(["new", "mid", "old"]);
  });
});
