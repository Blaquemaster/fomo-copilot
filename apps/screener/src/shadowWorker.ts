import { createPool, serviceEnabled, shadowAcceptance, startApp } from "@fomo/core";

const POLL_MS = 60_000;

/**
 * Collection-only shadow. Compose does not start it. The process exits unless
 * SHADOW_ENABLED is the exact word true. This file does not send Telegram and
 * does not insert a trade intent. Returns are not read and not logged.
 */
await startApp({
  app: "shadow",
  run: async ({ env, logger }) => {
    if (!serviceEnabled(env.SHADOW_ENABLED)) {
      logger.warn(
        { shadowEnabled: env.SHADOW_ENABLED ?? "unset" },
        "shadow runner stayed stopped: SHADOW_ENABLED is not true",
      );
      return;
    }
    const pool = createPool(env.DATABASE_URL);
    try {
      for (;;) {
        const trades = await pool.query<{ n: string }>(
          "select count(*)::text as n from autobuy_intent",
        );
        const report = shadowAcceptance({
          tradesCreated: Number(trades.rows[0]?.n ?? 0),
          telegramSends: 0,
          autoEnabled: serviceEnabled(env.PAPER_ENABLED) || serviceEnabled(env.ALERTS_ENABLED),
          unintendedProdWrites: 0,
          recall: [],
          dispatchWithin60s: 0,
          dispatchAttempts: 0,
          silentDrops: 0,
          peakRequests: 0,
          peakCapacity: 10,
          unresolvedByArm: [],
          completeMatched: 0,
          projectedWalletPerDay: 0,
          cashReconciled: false,
        });
        logger.info({ pass: report.pass, checks: report.checks }, "shadow acceptance");
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } finally {
      await pool.end();
    }
  },
});
