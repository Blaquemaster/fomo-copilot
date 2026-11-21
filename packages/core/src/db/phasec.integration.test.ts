import { describe, expect, it } from "vitest";

import { createPool, migrate, PhaseCRepository } from "../index.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("phasec mint cache against postgres", () => {
  it("stores a non-null exit impact as timestamptz", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const at = new Date("2026-11-21T14:55:00.000Z");
      const mint = "MintCacheTime111111111111111111111111111";
      await repo.saveMintCache(
        [
          {
            mint,
            mintAuthorityActive: false,
            freezeAuthorityActive: false,
            top10Pct: 12,
            sniperPct: 0,
            curveLiquidityUsd: 4_000,
            exitImpactPct: 1.5,
          },
        ],
        at,
      );
      const stored = await pool.query<{
        exit_impact_pct: number;
        exit_impact_at: Date;
        fetched_at: Date;
      }>(
        "select exit_impact_pct, exit_impact_at, fetched_at from phasec_mint_cache where mint = $1",
        [mint],
      );
      expect(Number(stored.rows[0]?.exit_impact_pct)).toBe(1.5);
      expect(stored.rows[0]?.exit_impact_at.toISOString()).toBe(at.toISOString());
      expect(stored.rows[0]?.fetched_at.toISOString()).toBe(at.toISOString());
    } finally {
      await pool.end();
    }
  }, 30_000);
});
