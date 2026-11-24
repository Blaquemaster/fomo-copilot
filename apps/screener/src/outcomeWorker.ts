import { createPool, PhaseCRepository, serviceEnabled, startApp } from "@fomo/core";

import { fetchSolPriceUsd } from "./jupiter.js";
import { priceDueCandidates } from "./outcomes.js";

/**
 * Own process for scheduled exit quotes. It is not the screener loop.
 * Compose does not start it unless the outcomes profile is requested, and the
 * process exits unless OUTCOMES_ENABLED is the exact word true. It does not
 * send Telegram and it does not write a trade intent.
 */
await startApp({
  app: "outcomes",
  run: async ({ env, logger }) => {
    if (!serviceEnabled(env.OUTCOMES_ENABLED)) {
      logger.warn(
        { outcomesEnabled: env.OUTCOMES_ENABLED ?? "unset" },
        "outcome worker stayed stopped: OUTCOMES_ENABLED is not true",
      );
      return;
    }
    const pool = createPool(env.DATABASE_URL);
    const store = new PhaseCRepository(pool);
    try {
      const sol = await fetchSolPriceUsd({ apiKey: env.JUPITER_API_KEY ?? null });
      const result = await priceDueCandidates({
        now: new Date(),
        store,
        solPriceUsd: sol.price,
        apiKey: env.JUPITER_API_KEY ?? null,
      });
      logger.info(result, "outcome pass");
    } finally {
      await pool.end();
    }
  },
});
