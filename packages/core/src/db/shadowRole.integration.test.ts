import { describe, expect, it } from "vitest";

import { createPool, migrate } from "../index.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("shadow role permissions", () => {
  it("allows a research insert and rejects a position or trade-intent write", async () => {
    const admin = createPool(databaseUrl ?? "");
    const restricted = createPool(databaseUrl ?? "");
    try {
      await migrate(admin);
      await admin.query("drop role if exists fomo_shadow_ci");
      await admin.query(
        "create role fomo_shadow_ci login nosuperuser nocreatedb nocreaterole password 'password1'",
      );
      const database = new URL(databaseUrl ?? "").pathname.replace(/^\//, "");
      await admin.query(`grant connect on database ${database} to fomo_shadow_ci`);
      await admin.query("grant usage on schema public to fomo_shadow_ci");
      await admin.query(
        "grant select, insert, update on phasec_observation, phasec_quote_attempt to fomo_shadow_ci",
      );
      await admin.query(
        "grant select on autobuy_intent, phasec_position, phasec_alert to fomo_shadow_ci",
      );
      await admin.query(
        "revoke insert, update, delete, truncate on phasec_position, phasec_alert, autobuy_intent, raw_events from fomo_shadow_ci",
      );
      await restricted.query("set role fomo_shadow_ci");
      await restricted.query(
        `insert into phasec_observation (mint, label, role, due_at)
         values ('shadow-role-mint', '15m', 'diagnostic', now())`,
      );
      await expect(
        restricted.query(
          `insert into phasec_position (mint, stage, arm, status, alert_at, entry_after)
           values ('shadow-role-mint', 'post_graduation', 'wallets_x_screen', 'pending', now(), now())`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        restricted.query(
          `insert into autobuy_intent (kind, mint, arm, stage, reason, simulated, created_at)
           values ('buy', 'shadow-role-mint', 'wallets_x_screen', 'post_graduation', 'test', 'no', now())`,
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await restricted.query("reset role").catch(() => undefined);
      await admin.query("drop role if exists fomo_shadow_ci").catch(() => undefined);
      await restricted.end();
      await admin.end();
    }
  });
});
