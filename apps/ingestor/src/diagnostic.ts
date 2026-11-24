import { pathToFileURL } from "node:url";

import { createPool, startApp } from "@fomo/core";

import { runDiagnosticCollection } from "./diagnosticRun.js";

const isDirect =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  await startApp({
    app: "ingestor",
    run: async ({ env }) => {
      const pool = createPool(env.DATABASE_URL);
      pool.on("error", () => undefined);
      try {
        const result = await runDiagnosticCollection({ pool, env });
        process.stdout.write(`diagnostic-result ${JSON.stringify(result)}\n`);
        if (result.roleRefused) process.exitCode = 1;
      } finally {
        await pool.end();
      }
    },
  });
}
