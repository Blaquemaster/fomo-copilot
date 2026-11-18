import { describe, expect, it } from "vitest";

import { FLAP_LAUNCHPAD, TOPIC_TAX_SET } from "@fomo/core";
import type { IngestRepository } from "@fomo/core";

import { handlePortalLog, portalLogFilter, runBscIngest } from "./bsc.js";

describe("bsc flap intake", () => {
  it("does not open a socket when BSC_WSS_URL is unset", async () => {
    let opened = false;
    await runBscIngest({
      env: { BSC_WSS_URL: undefined } as never,
      logger: { error() {}, info() {}, warn() {}, debug() {} } as never,
      repo: {} as IngestRepository,
      signal: new AbortController().signal,
      deps: {
        openSocket: () => {
          opened = true;
          throw new Error("should not connect");
        },
      },
    });
    expect(opened).toBe(false);
  });

  it("subscribes only to create, tax, graduation, and CL pool logs", () => {
    const filter = portalLogFilter();
    expect(filter.address).toBe("0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0");
    expect(filter.topics[0]).toContain(TOPIC_TAX_SET);
    expect(filter.topics[0]?.join(" ")).not.toContain("TokenBought");
  });

  it("stores a tax rate on the asset and does not screen it", async () => {
    const assets: Array<{ launchpad: string; taxBps: number | null }> = [];
    const repo = {
      rememberAsset: async (input: { launchpad: string; taxBps: number | null }) => {
        assets.push(input);
      },
      insertChainEvent: async () => true,
    };
    await handlePortalLog(
      repo as unknown as IngestRepository,
      {
        topics: [TOPIC_TAX_SET],
        data:
          "0x" +
          "2222222222222222222222222222222222222222".padStart(64, "0") +
          (150).toString(16).padStart(64, "0"),
        blockNumber: 10,
        txHash: "0xabc",
        logIndex: 1,
      },
      async () => {
        throw new Error("screen");
      },
    );
    expect(assets).toEqual([
      expect.objectContaining({ launchpad: FLAP_LAUNCHPAD, taxBps: 150, chain: "bsc" }),
    ]);
  });
});
