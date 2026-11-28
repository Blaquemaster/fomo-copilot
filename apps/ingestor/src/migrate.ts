import { pathToFileURL } from "node:url";

import { createPool, loadEnv, migrate } from "@fomo/core";

const isDirect =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  const env = loadEnv();
  const pool = createPool(env.DATABASE_URL);
  try {
    await migrate(pool);
    process.stdout.write("migrate complete\n");
  } finally {
    await pool.end();
  }
}
