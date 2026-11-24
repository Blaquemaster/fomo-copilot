import { createPool, PhaseCRepository, serviceEnabled, startApp } from "@fomo/core";

import { fetchSolPriceUsd } from "./jupiter.js";
import { priceDueCandidates, priceDueObservations } from "./outcomes.js";

const POLL_MS = 20_000;

/**
 * Own process for scheduled exit quotes. It is not the screener loop.
 * Compose does not start it, and the process exits unless OUTCOMES_ENABLED
 * is the exact word true. It does not send Telegram and it does not write a
 * trade intent. While enabled it keeps polling so a stopped screener does not
 * drop a due quote.
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
      for (;;) {
        const sol = await fetchSolPriceUsd({ apiKey: env.JUPITER_API_KEY ?? null });
        const horizons = await priceDueObservations({
          now: new Date(),
          store,
          solPriceUsd: sol.price,
          apiKey: env.JUPITER_API_KEY ?? null,
        });
        const legacy = await priceDueCandidates({
          now: new Date(),
          store,
          solPriceUsd: sol.price,
          apiKey: env.JUPITER_API_KEY ?? null,
        });
        logger.info({ horizons, legacy }, "outcome pass");
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    } finally {
      await pool.end();
    }
  },
});
