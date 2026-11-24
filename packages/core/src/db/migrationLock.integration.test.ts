import { describe, expect, it } from "vitest";

import { createPool, migrate } from "../index.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("migration lock timeout", () => {
  it("fails a locked change within 3 seconds and then reruns cleanly", async () => {
    const pool = createPool(databaseUrl ?? "");
    await migrate(pool);
    const holder = await pool.connect();
    const waiter = await pool.connect();
    try {
      await holder.query("begin");
      await holder.query("create table if not exists migration_lock_probe (id integer)");
      await holder.query("commit");
      await holder.query("begin");
      await holder.query("lock table migration_lock_probe in access exclusive mode");
      const started = Date.now();
      await waiter.query("begin");
      await waiter.query("set local lock_timeout = '3s'");
      await waiter.query("set local statement_timeout = '60s'");
      let failed = false;
      try {
        await waiter.query("alter table migration_lock_probe add column if not exists extra text");
      } catch (error) {
        failed = true;
        const code = (error as { code?: string }).code;
        expect(code).toBe("55P03");
      }
      expect(failed).toBe(true);
      expect(Date.now() - started).toBeGreaterThan(2_000);
      expect(Date.now() - started).toBeLessThan(10_000);
      await waiter.query("rollback");
      await holder.query("rollback");
      await waiter.query("begin");
      await waiter.query("set local lock_timeout = '3s'");
      await waiter.query("alter table migration_lock_probe add column if not exists extra text");
      await waiter.query("commit");
    } finally {
      await holder.query("rollback").catch(() => undefined);
      holder.release();
      waiter.release();
    }
    await migrate(pool);
    await pool.end();
  }, 20_000);
});
