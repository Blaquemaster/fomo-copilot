import { describe, expect, it } from "vitest";

import { scanInstructionHistory } from "./helius.js";

describe("parsed events scan", () => {
  it("asks for initialize names inside a slot window and meters creditsCharged", async () => {
    const result = await scanInstructionHistory({
      apiKey: "test-key",
      programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
      instructionNames: ["initialize_pool"],
      slotGt: 10,
      slotLte: 90,
      fetchImpl: ((url: string, init?: RequestInit) => {
        expect(String(url)).toContain("/v1/parsed-events/scan?api-key=test-key");
        const body = JSON.parse(String(init?.body)) as {
          address: string;
          match: { programs: Array<{ instructions: string[]; scope: string }> };
          returnShape: string;
          slot: { gt: number; lte: number };
        };
        expect(body.address).toBe("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");
        expect(body.match.programs[0]?.instructions).toEqual(["initialize_pool"]);
        expect(body.match.programs[0]?.scope).toBe("transaction");
        expect(body.returnShape).toBe("signatures");
        expect(body.slot).toEqual({ gt: 10, lte: 90 });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ signature: "sig", slot: 50, transactionIndex: 1, blockTime: 1 }],
              scan: { creditsCharged: 12, scannedTransactions: 1495, stoppedOn: "windowEnd" },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch,
    });
    expect(result).toEqual({
      matches: [{ signature: "sig", slot: 50 }],
      creditsCharged: 12,
      complete: true,
    });
  });

  it("does not put the api key in an HTTP error", async () => {
    await expect(
      scanInstructionHistory({
        apiKey: "test-key",
        programId: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
        instructionNames: ["initialize_pool"],
        slotGt: 10,
        slotLte: null,
        fetchImpl: (() => Promise.resolve(new Response("no", { status: 400 }))) as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400/);
  });
});
