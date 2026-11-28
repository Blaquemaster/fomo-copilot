import { createPool, migrate, IngestRepository, startApp } from "@fomo/core";

import { bscIngestEnabled, runBscIngest } from "./bsc.js";
import { runIngestLoop } from "./loop.js";

await startApp({
  app: "ingestor",
  run: async ({ env, logger }) => {
    if (process.argv.includes("--crash-test")) {
      throw new Error("intentional crash test");
    }
    const pool = createPool(env.DATABASE_URL, { synchronousCommitOff: true });
    const repo = new IngestRepository(pool);
    try {
      await migrate(pool);
      if (process.argv.includes("--spot-check")) {
        process.stdout.write(`${await repo.spotCheckText(20)}\n`);
        return;
      }
      logger.info(
        { mode: env.INGEST_MODE, plan: env.HELIUS_PLAN, wsMode: env.HELIUS_WS_MODE },
        "starting helius ingest",
      );
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      const bsc = bscIngestEnabled(env)
        ? runBscIngest({ env, logger, repo, signal: controller.signal }).catch((error: unknown) => {
            logger.error({ err: error }, "bsc ingest exited");
          })
        : Promise.resolve();
      try {
        await runIngestLoop({ env, logger, repo, signal: controller.signal });
      } finally {
        controller.abort();
        await bsc;
      }
    } finally {
      await pool.end();
    }
  },
});
