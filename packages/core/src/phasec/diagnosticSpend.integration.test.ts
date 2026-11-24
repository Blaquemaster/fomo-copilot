import { describe, expect, it } from "vitest";

import { createPool } from "../index.js";
import { EXHAUSTION_EFFECT, chargeDiagnostic, ensureDiagnosticSpend } from "./diagnosticSpend.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("diagnostic spend is shared and does not stop the ingestor", () => {
  it("exhausts a small budget across a retry and a restarted pool", async () => {
    const scope = `ci-${Date.now()}`;
    const caps = { heliusCredits: 3, jupiterQuotes: 2, publicRpcCalls: 2, usdMicros: 1_000_000n };
    const first = createPool(databaseUrl ?? "");
    const second = createPool(databaseUrl ?? "");
    try {
      await ensureDiagnosticSpend(first);
      const accepted = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        accepted.push(
          await chargeDiagnostic(first, {
            scope,
            provider: "helius",
            method: "getTransaction",
            processId: "worker-a",
            caps,
          }),
        );
      }
      expect(accepted.every((row) => row.allowed)).toBe(true);
      expect(accepted[2]?.heliusCredits).toBe(3);
      const retry = await chargeDiagnostic(second, {
        scope,
        provider: "helius",
        method: "getTransaction",
        processId: "worker-b",
        caps,
      });
      expect(retry.allowed).toBe(false);
      expect(retry.reason).toBe("helius");
      expect(retry.heliusCredits).toBe(3);
      expect(retry.ingestorStopped).toBe(false);
      await first.end();
      const restarted = createPool(databaseUrl ?? "");
      try {
        const again = await chargeDiagnostic(restarted, {
          scope,
          provider: "helius",
          method: "parsedEventsScan",
          historyPages: 1,
          processId: "worker-a-restarted",
          caps,
        });
        expect(again.allowed).toBe(false);
        expect(again.heliusCredits).toBe(3);
        expect(again.ingestorStopped).toBe(false);
        expect(EXHAUSTION_EFFECT.ingestor).toBe("keeps_running");
        expect(EXHAUSTION_EFFECT.allowance).toBe("diagnostic_additions_only");
      } finally {
        await restarted.end();
      }
      const jupiter = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        jupiter.push(
          await chargeDiagnostic(second, {
            scope,
            provider: "jupiter",
            method: "quote",
            processId: "quotes",
            caps,
          }),
        );
      }
      expect(jupiter[0]?.allowed).toBe(true);
      expect(jupiter[1]?.allowed).toBe(true);
      expect(jupiter[2]?.allowed).toBe(false);
      expect(jupiter[2]?.reason).toBe("jupiter");
      expect(jupiter[2]?.jupiterQuotes).toBe(2);
      const rpc = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        rpc.push(
          await chargeDiagnostic(second, {
            scope,
            provider: "public_rpc",
            method: "getSignaturesForAddress",
            processId: "recall",
            caps,
          }),
        );
      }
      expect(rpc[2]?.allowed).toBe(false);
      expect(rpc[2]?.reason).toBe("public_rpc");
      expect(rpc[2]?.publicRpcCalls).toBe(2);
      const tight = `usd-${Date.now()}`;
      const dollarCaps = { ...caps, heliusCredits: 100, usdMicros: 10n };
      const firstDollar = await chargeDiagnostic(second, {
        scope: tight,
        provider: "helius",
        method: "getSlot",
        processId: "quotes",
        caps: dollarCaps,
      });
      expect(firstDollar.allowed).toBe(true);
      const secondDollar = await chargeDiagnostic(second, {
        scope: tight,
        provider: "helius",
        method: "getSlot",
        processId: "quotes",
        caps: dollarCaps,
      });
      expect(secondDollar.allowed).toBe(true);
      const thirdDollar = await chargeDiagnostic(second, {
        scope: tight,
        provider: "helius",
        method: "getSlot",
        processId: "quotes",
        caps: dollarCaps,
      });
      expect(thirdDollar.allowed).toBe(false);
      expect(thirdDollar.reason).toBe("dollar");
      expect(thirdDollar.ingestorStopped).toBe(false);
      expect(thirdDollar.spentUsdMicros).toBe("10");
    } finally {
      await second.end();
    }
  }, 20_000);
});
