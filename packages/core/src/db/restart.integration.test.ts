import { describe, expect, it } from "vitest";

import { createPool, IngestRepository, migrate, PhaseCRepository } from "../index.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("enrollment/outcome restart integration test", () => {
  it("keeps one enrollment, its horizon rows, and a recovery checkpoint across a new connection", async () => {
    const mint = "RestartMint1111111111111111111111111111111";
    const first = createPool(databaseUrl ?? "");
    const at = new Date("2026-11-24T12:00:00.000Z");
    try {
      await migrate(first);
      const store = new PhaseCRepository(first);
      const row = {
        mint,
        stage: "post_graduation" as const,
        group: "wallet",
        verdict: "pass" as const,
        reason: "restart",
        recordedOnly: true,
        duringPause: false,
        alertPriceUsd: 1,
        outcomeDueAt: at,
        execution: {
          enrolledAt: at,
          entryAt: new Date(at.getTime() + 180_000),
          eventAt: at,
          venue: "pump",
          intendedSpendUsd: 20,
          route: "unknown" as const,
          feeHighUsd: 1.9,
          feeLowUsd: 0.8,
          acquiredQtyHigh: 19.05,
          acquiredQtyLow: 19.6,
          entryQuoteUsd: 1,
          decisionLatencyMs: 1_000,
          facts: { group: "wallet", top10HoldersPct: 10 },
        },
      };
      await store.insertCandidates([row], at);
      await store.insertCandidates([{ ...row, reason: "duplicate", execution: undefined }], at);
      await store.recordWalletList("abc", 2, at, null);
      await new IngestRepository(first).insertRecoveryCheckpoint({
        programId: "restart-check",
        fromSlot: 1,
        toSlot: 5_000,
        pageBefore: null,
        signaturesSeen: 3,
        finished: true,
        recoveryCompletedAt: at,
        recordedAt: at,
      });
    } finally {
      await first.end();
    }

    const second = createPool(databaseUrl ?? "");
    try {
      const execution = await second.query<{ route: string; n: string }>(
        "select route, count(*)::text as n from phasec_execution where mint = $1 group by route",
        [mint],
      );
      const observations = await second.query<{ n: string }>(
        "select count(*)::text as n from phasec_observation where mint = $1",
        [mint],
      );
      const facts = await second.query<{ decision_facts: { group?: string } | null }>(
        "select decision_facts from phasec_candidate where mint = $1",
        [mint],
      );
      expect(execution.rows[0]?.n).toBe("1");
      expect(execution.rows[0]?.route).toBe("unknown");
      expect(Number(observations.rows[0]?.n)).toBeGreaterThanOrEqual(8);
      const checkpoint = await second.query<{ recovery_completed_at: Date }>(
        "select recovery_completed_at from ingest_recovery_checkpoint where program_id = $1",
        ["restart-check"],
      );
      expect(facts.rows[0]?.decision_facts?.group).toBe("wallet");
      expect(checkpoint.rows[0]?.recovery_completed_at.toISOString()).toBe(at.toISOString());
    } finally {
      await second.end();
    }
  });

  it("claims an observation once, blocks a second claim, and allows a re-take after expiry", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const store = new PhaseCRepository(pool);
      const now = new Date("2026-11-24T13:00:00.000Z");
      const first = await store.claimObservation(
        "RestartMint1111111111111111111111111111111",
        "15m",
        now,
      );
      const again = await store.claimObservation(
        "RestartMint1111111111111111111111111111111",
        "15m",
        new Date(now.getTime() + 1000),
      );
      const retaken = await store.claimObservation(
        "RestartMint1111111111111111111111111111111",
        "15m",
        new Date(now.getTime() + 3 * 60 * 1000),
      );
      expect(first).toBe(true);
      expect(again).toBe(false);
      expect(retaken).toBe(true);
    } finally {
      await pool.end();
    }
  });
});
