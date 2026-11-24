import { createPool, migrate, PhaseCRepository, startApp } from "@fomo/core";

/**
 * One restart of the collection tables. Not started by a normal deploy.
 * It writes only to the database named by DATABASE_URL, inserts one mint,
 * closes the pool, opens a new one, and checks the row is still there once.
 */
await startApp({
  app: "stack-test",
  run: async ({ env, logger }) => {
    const mint = "RestartMint1111111111111111111111111111111";
    const first = createPool(env.DATABASE_URL);
    try {
      await migrate(first);
      const store = new PhaseCRepository(first);
      const at = new Date();
      await store.insertCandidates(
        [
          {
            mint,
            stage: "post_graduation",
            group: "wallet",
            verdict: "pass",
            reason: "restart check",
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
              route: "unknown",
              feeHighUsd: 1.9,
              feeLowUsd: 0.8,
              acquiredQtyHigh: 19.05,
              acquiredQtyLow: 19.6,
              entryQuoteUsd: 1,
              decisionLatencyMs: 1_000,
              facts: { group: "wallet" },
            },
          },
        ],
        at,
      );
      await store.insertCandidates(
        [
          {
            mint,
            stage: "post_graduation",
            group: "wallet",
            verdict: "pass",
            reason: "duplicate",
            recordedOnly: true,
            duringPause: false,
            alertPriceUsd: 1,
            outcomeDueAt: at,
          },
        ],
        at,
      );
    } finally {
      await first.end();
    }
    const second = createPool(env.DATABASE_URL);
    try {
      const again = await second.query<{ n: string }>(
        "select count(*)::text as n from phasec_execution where mint = $1",
        [mint],
      );
      const observations = await second.query<{ n: string }>(
        "select count(*)::text as n from phasec_observation where mint = $1",
        [mint],
      );
      if (again.rows[0]?.n !== "1") throw new Error("execution row did not survive restart");
      if (Number(observations.rows[0]?.n ?? 0) < 4)
        throw new Error("horizon rows missing after restart");
      logger.info(
        { mint, execution: 1, observations: observations.rows[0]?.n },
        "restart check passed",
      );
    } finally {
      await second.end();
    }
  },
});
