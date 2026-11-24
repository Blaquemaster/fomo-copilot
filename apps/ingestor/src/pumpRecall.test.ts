import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUMP_AMM_PROGRAM_ID } from "@fomo/core";

import {
  PUBLIC_SOLANA_RPC,
  recallLaunchLabFromPublicRpc,
  recallMeteoraFromPublicRpc,
  recallPumpFromPublicRpc,
  recallPumpSwapFromPublicRpc,
} from "./pumpRecall.js";

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

  it("recalls PumpSwap, LaunchLab, and Meteora from the public RPC and is not on the live loop", async () => {
    const programs: string[] = [];
    const fetchImpl = (async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body)) as { params?: [string] };
      programs.push(body.params?.[0] ?? "");
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: [{ signature: "seen" }] }),
      };
    }) as unknown as typeof fetch;
    await recallPumpSwapFromPublicRpc({ known: new Set(), fetchImpl });
    await recallLaunchLabFromPublicRpc({ known: new Set(), fetchImpl });
    const meteora = await recallMeteoraFromPublicRpc({ known: new Set(["seen"]), fetchImpl });
    expect(programs[0]).toBe(PUMP_AMM_PROGRAM_ID);
    expect(programs).toHaveLength(4);
    expect(meteora.missing).toEqual([]);
    const loop = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "loop.ts"),
      "utf8",
    );
    expect(loop).not.toContain("recallPumpSwapFromPublicRpc");
    expect(loop).not.toContain("recallMeteoraFromPublicRpc");
    expect(loop).not.toContain("walkSignatureGap");
  });
});
