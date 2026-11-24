import { describe, expect, it } from "vitest";

import { createPool, migrate, PhaseCRepository } from "../index.js";

const databaseUrl = process.env["PHASEC_TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("phasec mint cache against postgres", () => {
  it("stores a non-null exit impact as timestamptz", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const at = new Date("2026-11-21T14:55:00.000Z");
      const mint = "MintCacheTime111111111111111111111111111";
      await repo.saveMintCache(
        [
          {
            mint,
            mintAuthorityActive: false,
            freezeAuthorityActive: false,
            top10Pct: 12,
            sniperPct: 0,
            curveLiquidityUsd: 4_000,
            exitImpactPct: 1.5,
          },
        ],
        at,
      );
      const stored = await pool.query<{
        exit_impact_pct: number;
        exit_impact_at: Date;
        fetched_at: Date;
      }>(
        "select exit_impact_pct, exit_impact_at, fetched_at from phasec_mint_cache where mint = $1",
        [mint],
      );
      expect(Number(stored.rows[0]?.exit_impact_pct)).toBe(1.5);
      expect(stored.rows[0]?.exit_impact_at.toISOString()).toBe(at.toISOString());
      expect(stored.rows[0]?.fetched_at.toISOString()).toBe(at.toISOString());
    } finally {
      await pool.end();
    }
  }, 30_000);
});

describe.skipIf(!databaseUrl)("phasec positions against postgres", () => {
  it("closes priced and unpriced positions without a parameter type error", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const at = new Date("2026-11-22T17:00:00.000Z");
      const ids: string[] = [];
      for (const mint of [
        "ClosePriced1111111111111111111111111111111",
        "CloseUnpriced11111111111111111111111111111",
      ]) {
        await repo.insertEntry({
          mint,
          stage: "trench",
          arm: "wallets_x_screen",
          sizePct: 0.5,
          strength: 0.55,
          exitPlan: "plan",
          text: "entry",
          held: false,
          alertAt: at,
          entryAfter: at,
        });
        const row = await pool.query<{ id: string }>(
          "select id from phasec_position where mint = $1 order by id desc limit 1",
          [mint],
        );
        const id = String(row.rows[0]?.id);
        ids.push(id);
        await repo.openPosition(id, 1e-12, 1.2, 0, 5, "5000", 0.1, "jupiter", at);
      }
      const later = new Date("2026-11-22T18:05:00.000Z");
      await repo.closePosition({
        id: ids[0] ?? "",
        quote: 2e-12,
        net: 0.8,
        net2x: 0.7,
        reason: "horizon",
        impactPct: 1.1,
        feeUsd: 0,
        failure: null,
        fomoFeeUsd: 0.1,
        quoteSource: "curve_modeled",
        at: later,
      });
      await repo.closePosition({
        id: ids[1] ?? "",
        quote: 0,
        net: -1,
        net2x: -1,
        reason: "unpriced",
        impactPct: null,
        feeUsd: null,
        failure: "no_quote",
        quoteSource: null,
        at: later,
      });
      const rows = await pool.query<{
        status: string;
        net_return: number | null;
        exit_reason: string;
      }>(
        "select status, net_return, exit_reason from phasec_position where id = any($1::bigint[]) order by id",
        [ids],
      );
      expect(rows.rows.map((row) => row.status)).toEqual(["closed", "unpriced"]);
      expect(Number(rows.rows[0]?.net_return)).toBeCloseTo(0.8);
      expect(Number(rows.rows[1]?.net_return)).toBeCloseTo(-1);
      const resolved = await repo.resolvedReturns();
      expect(resolved.some((row) => Math.abs(row.net - 0.8) < 1e-9)).toBe(true);
      expect(resolved.some((row) => row.net === -1)).toBe(true);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("ignores top 10 values cached before the wallet-only method", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const mint = "TopTenLegacy111111111111111111111111111111";
      await pool.query(
        `insert into phasec_mint_cache (mint, top10_pct, fetched_at) values ($1, 100, now())
         on conflict (mint) do update set top10_pct = 100, top10_method = null`,
        [mint],
      );
      const fresh = {
        mintAuthorityActive: false,
        freezeAuthorityActive: false,
        sniperPct: null,
        curveLiquidityUsd: null,
        exitImpactPct: null,
      };
      await repo.saveMintCache([{ mint, ...fresh, top10Pct: null }], new Date());
      let stored = await pool.query<{ top10_pct: number | null; top10_method: string | null }>(
        "select top10_pct, top10_method from phasec_mint_cache where mint = $1",
        [mint],
      );
      expect(stored.rows[0]?.top10_pct).toBeNull();
      await repo.saveMintCache([{ mint, ...fresh, top10Pct: 12.5 }], new Date());
      await repo.saveMintCache([{ mint, ...fresh, top10Pct: null }], new Date());
      stored = await pool.query(
        "select top10_pct, top10_method from phasec_mint_cache where mint = $1",
        [mint],
      );
      expect(Number(stored.rows[0]?.top10_pct)).toBe(12.5);
      expect(stored.rows[0]?.top10_method).toBe("wallets_v3");
    } finally {
      await pool.end();
    }
  }, 30_000);
});

const TIP = 900_000_000;

describe.skipIf(!databaseUrl)("phasec live wallet signal against postgres", () => {
  it("counts only selective wallets that still hold and bought recently", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      await pool.query("delete from wallet_fill where slot > $1", [TIP - 1_000_000]);
      await pool.query(
        "delete from candidates where source = 'stream' and first_seen_at > now() - interval '7 hours'",
      );
      const repo = new PhaseCRepository(pool);
      const mints = {
        bot: "SignalBotOnly11111111111111111111111111pump",
        fresh: "SignalFresh111111111111111111111111111pump",
        sold: "SignalSold1111111111111111111111111111pump",
        stale: "SignalStale111111111111111111111111111pump",
      };
      let index = 0;
      for (const mint of Object.values(mints)) {
        index += 1;
        await pool.query(
          `insert into candidates
             (mint, pool, pool_type, first_seen_slot, first_seen_at, source_signature)
           values ($1, $2, 'pump', $3, now() - interval '30 minutes', $4)
           on conflict (pool) do update set first_seen_at = now() - interval '30 minutes'`,
          [mint, `pool-${mint}`, TIP - 5_000, `sig-create-${index.toString()}`],
        );
      }
      const fill = async (wallet: string, mint: string, side: string, slot: number) => {
        index += 1;
        await pool.query(
          `insert into wallet_fill (signature, event_index, slot, mint, wallet, side, venue)
           values ($1, 0, $2, $3, $4, $5, 'pump')`,
          [`sig-${index.toString()}`, slot, mint, wallet, side],
        );
      };
      // A flip bot that touched 41 mints today, including the bot-only coin.
      await fill("BotWallet", mints.bot, "buy", TIP - 100);
      for (let other = 0; other < 40; other += 1) {
        await fill("BotWallet", `BotOther${other.toString()}`, "buy", TIP - 200);
      }
      await fill("FreshWallet", mints.fresh, "buy", TIP - 100);
      await fill("SoldWallet", mints.sold, "buy", TIP - 300);
      await fill("SoldWallet", mints.sold, "sell", TIP - 200);
      // Bought about two hours ago: still held but no longer a fresh signal.
      await fill("StaleWallet", mints.stale, "buy", TIP - 18_000);
      await fill("TipWallet", "TipMint", "buy", TIP);

      const coins = await repo.coins(200, { maxMintsPerDay: 40, freshMinutes: 60 });
      const buyers = new Map(coins.map((coin) => [coin.mint, coin.trackedBuyers]));
      expect(buyers.get(mints.fresh)).toBe(1);
      expect(buyers.get(mints.bot)).toBe(0);
      expect(buyers.get(mints.sold)).toBe(0);
      expect(buyers.get(mints.stale)).toBe(0);

      const loose = await repo.coins(200, { maxMintsPerDay: 1_000, freshMinutes: 180 });
      const looseBuyers = new Map(loose.map((coin) => [coin.mint, coin.trackedBuyers]));
      expect(looseBuyers.get(mints.bot)).toBe(1);
      expect(looseBuyers.get(mints.stale)).toBe(1);
      expect(looseBuyers.get(mints.sold)).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

describe.skipIf(!databaseUrl)("phasec closedBetween against postgres", () => {
  it("excludes control and voided closes from the daily loss window", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const start = new Date("2026-11-23T05:00:00.000Z");
      const mid = new Date("2026-11-23T10:00:00.000Z");
      const end = new Date("2026-11-23T15:00:00.000Z");
      const openAndClose = async (mint: string, arm: string, net: number, at: Date) => {
        await repo.insertEntry({
          mint,
          stage: "trench",
          arm,
          sizePct: 0.5,
          strength: 0.55,
          exitPlan: "plan",
          text: "entry",
          held: arm === "random_pass",
          heldReason: arm === "random_pass" ? "control" : null,
          alertAt: at,
          entryAfter: at,
        });
        const row = await pool.query<{ id: string }>(
          "select id from phasec_position where mint = $1 order by id desc limit 1",
          [mint],
        );
        const id = String(row.rows[0]?.id);
        await repo.openPosition(id, 1e-12, 1, 0, 5, "5000", 0.1, "jupiter", at);
        await repo.closePosition({
          id,
          quote: 1e-12,
          net,
          net2x: net,
          reason: "horizon",
          impactPct: 1,
          feeUsd: 0,
          failure: null,
          fomoFeeUsd: 0.1,
          quoteSource: "jupiter",
          at,
        });
        return id;
      };
      const voidedId = await openAndClose(
        "ClosedVoided11111111111111111111111111111",
        "wallets_x_screen",
        -0.5,
        mid,
      );
      await repo.voidPaperWindow(mid);
      await openAndClose("ClosedControl1111111111111111111111111111", "random_pass", -0.4, mid);
      await openAndClose(
        "ClosedStrategy111111111111111111111111111",
        "wallets_x_screen",
        -0.1,
        mid,
      );
      const rows = await repo.closedBetween(start, end);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.netReturn).toBeCloseTo(-0.1);
      expect(rows[0]?.sizePct).toBeCloseTo(0.5);
      const voided = await pool.query<{ restarted_at: Date | null }>(
        "select restarted_at from phasec_position where id = $1",
        [voidedId],
      );
      expect(voided.rows[0]?.restarted_at).not.toBeNull();
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("keeps the scale-out booking after the paper window is marked restarted", async () => {
    const pool = createPool(databaseUrl ?? "");
    try {
      await migrate(pool);
      const repo = new PhaseCRepository(pool);
      const at = new Date("2026-11-22T17:10:00.000Z");
      const mint = "ScalePersist11111111111111111111111111111";
      await repo.insertEntry({
        mint,
        stage: "trench",
        arm: "wallets_x_screen",
        sizePct: 0.5,
        strength: 0.55,
        exitPlan: "plan",
        text: "entry",
        held: false,
        alertAt: at,
        entryAfter: at,
      });
      const row = await pool.query<{ id: string }>(
        "select id from phasec_position where mint = $1 order by id desc limit 1",
        [mint],
      );
      const id = String(row.rows[0]?.id);
      await repo.openPosition(id, 1, 1, 0, 10, "100", 0.2, "jupiter", at);
      await repo.markScaled(
        [{ id, quote: 1.5, impactPct: 2, proceedsUsd: 7.35, feeUsd: 0.15 }],
        at,
      );
      const loaded = await repo.positions();
      const open = loaded.find((position) => position.id === id);
      expect(open?.scaleQuote).toBeCloseTo(1.5);
      expect(open?.scaleProceedsUsd).toBeCloseTo(7.35);
      expect(open?.scaledAt?.toISOString()).toBe(at.toISOString());
      await repo.voidPaperWindow(at);
      const stored = await pool.query<{
        scale_quote: number;
        scale_proceeds_usd: number;
        restarted_at: Date;
      }>(
        "select scale_quote, scale_proceeds_usd, restarted_at from phasec_position where id = $1",
        [id],
      );
      expect(Number(stored.rows[0]?.scale_quote)).toBeCloseTo(1.5);
      expect(Number(stored.rows[0]?.scale_proceeds_usd)).toBeCloseTo(7.35);
      expect(stored.rows[0]?.restarted_at).not.toBeNull();
    } finally {
      await pool.end();
    }
  }, 30_000);
});
