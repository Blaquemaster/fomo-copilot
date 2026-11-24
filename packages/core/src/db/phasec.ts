import pg from "pg";

import type { PassCoin, PassPosition, PlannedScale } from "../phasec/pass.js";
import type { ResolvedReturn } from "../phasec/paper.js";
import type { PaperArm, Stage } from "../phasec/protocol.js";
import {
  DEFAULT_WALLET_SIGNAL,
  type PhaseCStore,
  type WalletSignalRules,
} from "../phasec/store.js";
import type { TierWallet } from "../phasec/risk.js";

function date(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Top 10 cached before this method counted the bonding curve and pool vaults as holders, so it
 * read near 100% for every coin. Rows without this tag are ignored and re-fetched.
 */
export const TOP10_METHOD = "wallets_v3";

/** Fallback slot rate when no recent creates exist. Measured about 4.65 a second in Nov 2026. */
const DEFAULT_SLOTS_PER_SEC = 4.65;

export class PhaseCRepository implements PhaseCStore {
  constructor(private readonly pool: pg.Pool) {}

  async protocol(): Promise<{ fingerprint: string; body: string; registeredAt: Date } | null> {
    const result = await this.pool.query<{
      fingerprint: string;
      body: string;
      registered_at: Date;
    }>("select fingerprint, body, registered_at from phasec_protocol where id = 1");
    const row = result.rows[0];
    if (!row) return null;
    return { fingerprint: row.fingerprint, body: row.body, registeredAt: date(row.registered_at) };
  }

  async saveProtocol(fingerprint: string, body: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into phasec_protocol (id, fingerprint, body, registered_at)
       values (1, $1, $2, $3)
       on conflict (id) do nothing`,
      [fingerprint, body, at.toISOString()],
    );
  }

  async coins(
    limit: number,
    signal: WalletSignalRules = DEFAULT_WALLET_SIGNAL,
  ): Promise<PassCoin[]> {
    const result = await this.pool.query<{
      mint: string;
      first_seen_at: Date;
      graduated_at: Date | null;
      curve_completed_at: Date | null;
      tracked_buyers: number;
      transfer_fee_bps: number | null;
      creator_sells: number;
      tracked_sells: number;
      sniper_pct: number | null;
      top10_pct: number | null;
      mint_authority_active: boolean | null;
      freeze_authority_active: boolean | null;
      liquidity_usd: number | null;
      exit_impact_pct: number | null;
      bonding_curve: string | null;
      pool_type: string | null;
      created_slot: string | null;
    }>(
      `with tip as (select coalesce(max(slot), 0) as slot from wallet_fill),
       -- Slot windows from wall-clock windows, at the slot rate measured on recent creates.
       rate as (
         select case
           when extract(epoch from max(first_seen_at) - min(first_seen_at)) >= 600
             and max(first_seen_slot) > min(first_seen_slot)
           then (max(first_seen_slot) - min(first_seen_slot))::float
             / extract(epoch from max(first_seen_at) - min(first_seen_at))
           else ${DEFAULT_SLOTS_PER_SEC.toString()}
         end as per_sec
         from candidates
         where source = 'stream' and first_seen_at > now() - interval '6 hours'
       ),
       win as (
         select tip.slot - (rate.per_sec * 86400)::bigint as day_from,
                tip.slot - (rate.per_sec * 60 * $3::float)::bigint as fresh_from
         from tip, rate
       ),
       -- Tracked wallets that are selective. A wallet that touched more distinct mints than the
       -- cap in the last day is a flip bot, and its buys say nothing about a coin.
       selective as (
         select f.wallet from wallet_fill f, win
         where f.slot > win.day_from
         group by f.wallet
         having count(distinct f.mint) <= $2
       ),
       -- Per mint: selective wallets that are still net buyers and bought within the fresh
       -- window. A wallet that already sold out, or bought hours ago, is not a live signal.
       live_signal as (
         select x.mint, count(*)::int as tracked_buyers from (
           select f.mint, f.wallet,
             count(*) filter (where f.side in ('buy', 'swap')) as buys,
             count(*) filter (where f.side = 'sell') as sells,
             max(f.slot) filter (where f.side in ('buy', 'swap')) as last_buy
           from wallet_fill f
           join selective s on s.wallet = f.wallet
           cross join win
           where f.slot > win.day_from
           group by f.mint, f.wallet
         ) x, win
         where x.buys > x.sells and x.last_buy > win.fresh_from
         group by x.mint
       ),
       newest as (
         (select c.mint, c.first_seen_at, c.graduated_at, c.curve_completed_at, c.pool, c.pool_type
          from candidates c
          where c.source <> 'audit'
            and c.mint !~* '^0x'
            and c.pool_type <> 'flap'
          order by c.first_seen_at desc
          limit $1)
         union
         -- Wallet-backed coins still inside a stage window. The newest $1 creates span only a
         -- few minutes, so without this a coin tracked wallets bought fell out before it could
         -- be screened.
         (select c.mint, c.first_seen_at, c.graduated_at, c.curve_completed_at, c.pool, c.pool_type
          from candidates c
          join live_signal w0 on w0.mint = c.mint
          where c.source <> 'audit'
            and c.mint !~* '^0x'
            and c.pool_type <> 'flap'
            and w0.tracked_buyers >= 1
            and (c.first_seen_at > now() - interval '6 hours'
              or c.graduated_at > now() - interval '30 minutes')
          order by w0.tracked_buyers desc, c.first_seen_at desc
          limit $1)
       )
       select n.mint, n.first_seen_at, n.graduated_at, n.curve_completed_at,
              coalesce(w.tracked_buyers, 0) as tracked_buyers,
              coin.transfer_fee_bps,
              coalesce(stats.creator_sells, 0) as creator_sells,
              coalesce(sells.tracked_sells, 0) as tracked_sells,
              case when coalesce(snipers.buys, 0) = 0 then cache.sniper_pct else snipers.sniper_pct end as sniper_pct,
              case when cache.top10_method = '${TOP10_METHOD}' then cache.top10_pct end as top10_pct,
              cache.mint_authority_active,
              cache.freeze_authority_active,
              coalesce(snap.liquidity_usd, cache.curve_liquidity_usd) as liquidity_usd,
              case when cache.exit_impact_at > now() - interval '10 minutes'
                then cache.exit_impact_pct else null end as exit_impact_pct,
              coalesce(origin.launch_pool, pc.bonding_curve, coin.pool) as bonding_curve,
              n.pool_type,
              coalesce(origin.created_slot, pc.created_slot, coin.created_slot)::text as created_slot
       from newest n
       left join live_signal w on w.mint = n.mint
       left join ingest_coin coin on coin.mint = n.mint
       left join pump_coin_stats stats on stats.mint = n.mint
       left join pump_coin pc on pc.mint = n.mint
       left join lateral (
         select ev.slot as created_slot,
           case when ev.event_kind = 'dbc_initialize'
             then coalesce(ev.payload->>'virtualPool', ev.pool)
             else ev.pool
           end as launch_pool
         from raw_events ev
         where ev.mint = n.mint
           and ev.event_kind in ('pump_create','pump_create_v2','launchlab_initialize','dbc_initialize')
           and ev.pool is not null
         order by ev.slot asc
         limit 1
       ) origin on true
       left join phasec_mint_cache cache on cache.mint = n.mint
       left join lateral (
         select count(*)::int as tracked_sells from wallet_fill f
         where f.mint = n.mint and f.side = 'sell'
       ) sells on true
       left join lateral (
         select count(*) filter (where t.side = 'buy') as buys,
           case when count(*) filter (where t.side = 'buy') = 0 then null
             else count(*) filter (
               where t.side = 'buy' and t.is_creator = false and t.slot = p.created_slot
             )::float / count(*) filter (where t.side = 'buy') * 100
           end as sniper_pct
         from pump_trade t
         join pump_coin p on p.mint = t.mint
         where t.mint = n.mint
       ) snipers on true
       left join lateral (
         select liquidity_usd from phasec_market_snapshot s
         where s.mint = n.mint
         order by polled_at desc
         limit 1
       ) snap on true
       order by n.first_seen_at desc`,
      [limit, signal.maxMintsPerDay, signal.freshMinutes],
    );
    return result.rows.map((row) => ({
      mint: row.mint,
      createdAt: date(row.first_seen_at),
      graduatedAt: row.graduated_at ? date(row.graduated_at) : null,
      curveCompletedAt: row.curve_completed_at ? date(row.curve_completed_at) : null,
      trackedBuyers: Number(row.tracked_buyers),
      xMentions: null,
      liquidityUsd: row.liquidity_usd === null ? null : Number(row.liquidity_usd),
      transferFeeBps: row.transfer_fee_bps === null ? null : Number(row.transfer_fee_bps),
      mintAuthorityActive: row.mint_authority_active,
      freezeAuthorityActive: row.freeze_authority_active,
      exitQuoteImpactPct: row.exit_impact_pct === null ? null : Number(row.exit_impact_pct),
      top10HoldersPct: row.top10_pct === null ? null : Number(row.top10_pct),
      sniperBundlePct: row.sniper_pct === null ? null : Number(row.sniper_pct),
      trackedSells: Number(row.tracked_sells),
      uniqueMakers1h: null,
      creatorSells: Number(row.creator_sells),
      quoteError: false,
      secondWave: null,
      bondingCurve: row.bonding_curve,
      poolType: row.pool_type,
      createdSlot: row.created_slot === null ? null : Number(row.created_slot),
    }));
  }

  async mentionCounts(mints: readonly string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (mints.length === 0) return counts;
    const result = await this.pool.query<{ mint: string; mentions: number }>(
      "select mint, count(*)::int as mentions from coin_x_mention where mint = any($1::text[]) group by mint",
      [mints],
    );
    for (const row of result.rows) {
      if (row.mint) counts.set(row.mint, Number(row.mentions));
    }
    return counts;
  }

  async positions(): Promise<PassPosition[]> {
    const result = await this.pool.query<{
      id: string;
      mint: string;
      stage: Stage;
      arm: PaperArm;
      status: "pending" | "open";
      alert_at: Date;
      entry_after: Date;
      opened_at: Date | null;
      entry_quote: number | null;
      entry_size_usd: number | null;
      entry_fee_usd: number | null;
      entry_out_amount: string | null;
      sell_warned: boolean;
      scaled_at: Date | null;
      scale_quote: number | null;
      scale_impact_pct: number | null;
      scale_proceeds_usd: number | null;
      scale_fee_usd: number | null;
      size_pct: number;
      exit_plan: string;
      screen_failed: boolean;
    }>(
      `select id, mint, stage, arm, status, alert_at, entry_after, opened_at, entry_quote,
              entry_size_usd, entry_fee_usd, entry_out_amount, size_pct, exit_plan,
              screen_failed, sell_warned, scaled_at, scale_quote, scale_impact_pct,
              scale_proceeds_usd, scale_fee_usd
       from phasec_position
       where status in ('pending', 'open')
       order by alert_at`,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      mint: row.mint,
      stage: row.stage,
      arm: row.arm,
      status: row.status,
      alertAt: date(row.alert_at),
      entryAfter: date(row.entry_after),
      openedAt: row.opened_at ? date(row.opened_at) : null,
      entryQuote: row.entry_quote === null ? null : Number(row.entry_quote),
      entrySizeUsd: row.entry_size_usd === null ? null : Number(row.entry_size_usd),
      entryFeeUsd: row.entry_fee_usd === null ? null : Number(row.entry_fee_usd),
      entryOutAmount: row.entry_out_amount,
      sellWarned: row.sell_warned,
      scaledAt: row.scaled_at ? date(row.scaled_at) : null,
      scaleQuote: row.scale_quote === null ? null : Number(row.scale_quote),
      scaleImpactPct: row.scale_impact_pct === null ? null : Number(row.scale_impact_pct),
      scaleProceedsUsd: row.scale_proceeds_usd === null ? null : Number(row.scale_proceeds_usd),
      scaleFeeUsd: row.scale_fee_usd === null ? null : Number(row.scale_fee_usd),
      sizePct: Number(row.size_pct),
      exitPlan: row.exit_plan,
      screenFailed: row.screen_failed,
    }));
  }

  async closedBetween(
    start: Date,
    end: Date,
  ): Promise<Array<{ sizePct: number; netReturn: number }>> {
    const result = await this.pool.query<{ size_pct: number; net_return: number }>(
      `select size_pct, net_return from phasec_position
       where status = 'closed' and closed_at >= $1 and closed_at < $2 and net_return is not null
         and arm <> 'random_pass' and restarted_at is null`,
      [start.toISOString(), end.toISOString()],
    );
    return result.rows.map((row) => ({
      sizePct: Number(row.size_pct),
      netReturn: Number(row.net_return),
    }));
  }

  async isPaused(day: string): Promise<boolean> {
    const result = await this.pool.query("select 1 from phasec_pause where day = $1", [day]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async pause(day: string, reason: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into phasec_pause (day, reason, paused_at) values ($1, $2, $3)
       on conflict (day) do nothing`,
      [day, reason, at.toISOString()],
    );
  }

  async alerted(): Promise<Array<{ mint: string; stage: Stage }>> {
    const result = await this.pool.query<{ mint: string; stage: Stage }>(
      "select mint, stage from phasec_alert where kind = 'entry'",
    );
    return result.rows;
  }

  async recentEntryCount(since: Date): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "select count(*)::text as count from phasec_alert where kind = 'entry' and created_at >= $1 and coalesce(held_reason, '') <> 'control' and restarted_at is null",
      [since.toISOString()],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async held(): Promise<Array<{ id: string; text: string }>> {
    const result = await this.pool.query<{ id: string; body: string }>(
      "select id, body from phasec_alert where delivered_at is null and held_reason = 'quiet' order by created_at",
    );
    return result.rows.map((row) => ({ id: String(row.id), text: row.body }));
  }

  async insertEntry(input: {
    mint: string;
    stage: Stage;
    arm: string;
    sizePct: number;
    strength: number;
    exitPlan: string;
    text: string;
    held: boolean;
    heldReason?: "quiet" | "control" | null;
    fingerprint?: string | null;
    tradableInFomo?: boolean | null;
    sniperUnmeasured?: boolean;
    alertAt: Date;
    entryAfter: Date;
  }): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query<{ id: string }>(
        `insert into phasec_alert
          (mint, stage, arm, kind, created_at, delivered_at, held_reason, size_pct, strength, body,
           fingerprint, tradable_in_fomo, sniper_unmeasured)
         values ($1, $2, $3, 'entry', $4, null, $5, $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          input.mint,
          input.stage,
          input.arm,
          input.alertAt.toISOString(),
          input.heldReason ?? (input.held ? "quiet" : null),
          input.sizePct,
          input.strength,
          input.text,
          input.fingerprint ?? null,
          input.tradableInFomo ?? null,
          input.sniperUnmeasured ?? false,
        ],
      );
      await client.query(
        `insert into phasec_position
          (mint, stage, arm, status, alert_at, entry_after, size_pct, exit_plan, screen_failed,
           sniper_unmeasured)
         values ($1, $2, $3, 'pending', $4, $5, $6, $7, false, $8)`,
        [
          input.mint,
          input.stage,
          input.arm,
          input.alertAt.toISOString(),
          input.entryAfter.toISOString(),
          input.sizePct,
          input.exitPlan,
          input.sniperUnmeasured ?? false,
        ],
      );
      await client.query("commit");
      return String(inserted.rows[0]?.id ?? "");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async markDelivered(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(
      "update phasec_alert set delivered_at = $2 where id = any($1::bigint[]) and delivered_at is null",
      [ids, at.toISOString()],
    );
  }

  async openPosition(
    id: string,
    quote: number,
    impactPct: number,
    feeUsd: number,
    sizeUsd: number,
    outAmount: string,
    fomoFeeUsd: number,
    quoteSource: string,
    at: Date,
  ): Promise<void> {
    await this.pool.query(
      `update phasec_position
       set status = 'open', opened_at = $9, entry_quote = $2, entry_impact_pct = $3,
           entry_fee_usd = $4, entry_size_usd = $5, entry_out_amount = $6,
           fomo_fee_usd = $7, quote_source = $8
       where id = $1 and status = 'pending'`,
      [id, quote, impactPct, feeUsd, sizeUsd, outAmount, fomoFeeUsd, quoteSource, at.toISOString()],
    );
  }

  async markSellWarned(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.pool.query(
      "update phasec_position set sell_warned = true where id = any($1::bigint[])",
      [ids],
    );
  }

  async markScaled(rows: readonly PlannedScale[], at: Date): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `update phasec_position
         set scaled_at = $2, scale_quote = $3, scale_impact_pct = $4,
             scale_proceeds_usd = $5, scale_fee_usd = $6
         where id = $1::bigint and scaled_at is null`,
        [row.id, at.toISOString(), row.quote, row.impactPct, row.proceedsUsd, row.feeUsd],
      );
    }
  }

  async saveMintCache(
    rows: readonly {
      mint: string;
      mintAuthorityActive: boolean | null;
      freezeAuthorityActive: boolean | null;
      top10Pct: number | null;
      sniperPct: number | null;
      curveLiquidityUsd: number | null;
      exitImpactPct: number | null;
    }[],
    at: Date,
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `insert into phasec_mint_cache
          (mint, mint_authority_active, freeze_authority_active, top10_pct, sniper_pct, curve_liquidity_usd,
           exit_impact_pct, exit_impact_at, fetched_at, top10_method)
         values ($1,$2,$3,$4::double precision,$5,$6,$7, case when $7::double precision is null then null else $8::timestamptz end, $8::timestamptz,
           case when $4::double precision is null then null else '${TOP10_METHOD}' end)
         on conflict (mint) do update set
           mint_authority_active = coalesce(excluded.mint_authority_active, phasec_mint_cache.mint_authority_active),
           freeze_authority_active = coalesce(excluded.freeze_authority_active, phasec_mint_cache.freeze_authority_active),
           top10_pct = case
             when excluded.top10_pct is not null then excluded.top10_pct
             when phasec_mint_cache.top10_method = '${TOP10_METHOD}' then phasec_mint_cache.top10_pct
             else null end,
           top10_method = case
             when excluded.top10_pct is not null then excluded.top10_method
             else phasec_mint_cache.top10_method end,
           sniper_pct = coalesce(excluded.sniper_pct, phasec_mint_cache.sniper_pct),
           curve_liquidity_usd = coalesce(excluded.curve_liquidity_usd, phasec_mint_cache.curve_liquidity_usd),
           exit_impact_pct = coalesce(excluded.exit_impact_pct, phasec_mint_cache.exit_impact_pct),
           exit_impact_at = case when excluded.exit_impact_pct is not null then excluded.fetched_at
             else phasec_mint_cache.exit_impact_at end,
           fetched_at = excluded.fetched_at`,
        [
          row.mint,
          row.mintAuthorityActive,
          row.freezeAuthorityActive,
          row.top10Pct,
          row.sniperPct,
          row.curveLiquidityUsd,
          row.exitImpactPct,
          at.toISOString(),
        ],
      );
    }
  }

  async recentCandidates(days: number): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from candidates
       where source <> 'audit' and first_seen_at > now() - make_interval(days => $1)`,
      [days],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async secondWaveMints(
    limit: number,
  ): Promise<Array<{ mint: string; createdAt: Date; graduatedAt: Date }>> {
    const result = await this.pool.query<{
      mint: string;
      first_seen_at: Date;
      graduated_at: Date;
    }>(
      `select mint, first_seen_at, graduated_at
       from candidates
       where source <> 'audit'
         and mint !~* '^0x'
         and pool_type <> 'flap'
         and graduated_at is not null
         and graduated_at <= now() - interval '24 hours'
         and graduated_at >= now() - interval '30 days'
       order by graduated_at desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      mint: row.mint,
      createdAt: date(row.first_seen_at),
      graduatedAt: date(row.graduated_at),
    }));
  }

  async pruneSnapshots(olderThan: Date): Promise<void> {
    await this.pool.query("delete from phasec_market_snapshot where polled_at < $1", [
      olderThan.toISOString(),
    ]);
  }

  async saveSnapshots(
    rows: readonly {
      mint: string;
      at: Date;
      priceUsd: number | null;
      liquidityUsd: number | null;
      volume1h: number | null;
      volume24h?: number | null;
    }[],
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `insert into phasec_market_snapshot
          (mint, polled_at, price_usd, liquidity_usd, volume_1h, volume_24h)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (mint, polled_at) do nothing`,
        [
          row.mint,
          row.at.toISOString(),
          row.priceUsd,
          row.liquidityUsd,
          row.volume1h,
          row.volume24h ?? null,
        ],
      );
    }
  }

  async waveHistory(mints: readonly string[]): Promise<
    Map<
      string,
      {
        volume7dUsd: number | null;
        rangeHigh: number | null;
        liquidityGrowthPct: number | null;
      }
    >
  > {
    const history = new Map<
      string,
      {
        volume7dUsd: number | null;
        rangeHigh: number | null;
        liquidityGrowthPct: number | null;
      }
    >();
    if (mints.length === 0) return history;
    const result = await this.pool.query<{
      mint: string;
      range_high: number | null;
      first_liq: number | null;
      last_liq: number | null;
      volume_7d: number | null;
    }>(
      `with bounds as (
         select s.mint,
           max(s.price_usd) as range_high,
           (array_agg(s.liquidity_usd order by s.polled_at) filter (where s.liquidity_usd is not null))[1] as first_liq,
           (array_agg(s.liquidity_usd order by s.polled_at desc) filter (where s.liquidity_usd is not null))[1] as last_liq
         from phasec_market_snapshot s
         where s.mint = any($1::text[])
         group by s.mint
       ),
       daily as (
         select distinct on (mint, (polled_at at time zone 'utc')::date)
           mint, volume_24h
         from phasec_market_snapshot
         where mint = any($1::text[])
           and volume_24h is not null
           and polled_at >= now() - interval '8 days'
         order by mint, (polled_at at time zone 'utc')::date, polled_at desc
       ),
       vol as (
         select mint, case when count(*) >= 7 then sum(volume_24h) else null end as volume_7d
         from daily
         group by mint
       )
       select b.mint, b.range_high, b.first_liq, b.last_liq, v.volume_7d
       from bounds b
       left join vol v on v.mint = b.mint`,
      [mints],
    );
    for (const row of result.rows) {
      const first = row.first_liq === null ? null : Number(row.first_liq);
      const last = row.last_liq === null ? null : Number(row.last_liq);
      history.set(row.mint, {
        volume7dUsd: row.volume_7d === null ? null : Number(row.volume_7d),
        rangeHigh: row.range_high === null ? null : Number(row.range_high),
        liquidityGrowthPct:
          first !== null && first > 0 && last !== null ? ((last - first) / first) * 100 : null,
      });
    }
    return history;
  }

  async recordScreenCredits(credits: number, at: Date): Promise<void> {
    if (credits <= 0) return;
    await this.pool.query(
      `insert into ingest_feature_daily (feature, day, credit_micros, stored_events)
       values ('phasec_screen', $1::date, $2, $3)
       on conflict (feature, day) do update set
         credit_micros = ingest_feature_daily.credit_micros + excluded.credit_micros,
         stored_events = ingest_feature_daily.stored_events + excluded.stored_events`,
      [at.toISOString(), credits * 1_000_000, credits],
    );
  }

  async closePosition(input: {
    id: string;
    quote: number;
    net: number;
    net2x: number;
    reason: string;
    impactPct: number | null;
    feeUsd: number | null;
    failure: string | null;
    fomoFeeUsd?: number;
    quoteSource?: string | null;
    at: Date;
  }): Promise<void> {
    await this.pool.query(
      `update phasec_position
       set status = case when $5::text = 'unpriced' then 'unpriced' else 'closed' end,
           exit_quote = $2::double precision,
           net_return = case when $5::text = 'unpriced' then null else $3::double precision end,
           net_return_2x = case when $5::text = 'unpriced' then null else $4::double precision end,
           exit_reason = $5::text, exit_impact_pct = $6::double precision,
           exit_fee_usd = $7::double precision, quote_failure = $8::text, closed_at = $9::timestamptz,
           fomo_fee_usd = coalesce(fomo_fee_usd, 0) + coalesce($10::double precision, 0),
           quote_source = coalesce($11::text, quote_source)
       where id = $1::bigint and status in ('open', 'pending')`,
      [
        input.id,
        input.quote,
        input.net,
        input.net2x,
        input.reason,
        input.impactPct,
        input.feeUsd,
        input.failure,
        input.at.toISOString(),
        input.fomoFeeUsd ?? 0,
        input.quoteSource ?? null,
      ],
    );
  }

  async voidPaperWindow(at: Date): Promise<void> {
    await this.pool.query(
      `update phasec_position
       set status = case when status in ('pending', 'open') then 'voided' else status end,
           restarted_at = $1
       where restarted_at is null`,
      [at.toISOString()],
    );
    await this.pool.query("update phasec_alert set restarted_at = $1 where restarted_at is null", [
      at.toISOString(),
    ]);
  }

  async clearProtocol(): Promise<void> {
    await this.pool.query("delete from phasec_protocol where id = 1");
  }

  async tradableCounts(): Promise<{ yes: number; no: number; unknown: number }> {
    const result = await this.pool.query<{ tradable_in_fomo: boolean | null; count: string }>(
      `select tradable_in_fomo, count(*)::text as count from phasec_alert
       where kind = 'entry' and restarted_at is null
       group by tradable_in_fomo`,
    );
    const counts = { yes: 0, no: 0, unknown: 0 };
    for (const row of result.rows) {
      const count = Number(row.count);
      if (row.tradable_in_fomo === true) counts.yes += count;
      else if (row.tradable_in_fomo === false) counts.no += count;
      else counts.unknown += count;
    }
    return counts;
  }

  async scoreShadow(): Promise<{
    rankedCount: number;
    lookbackStart: string | null;
    lookbackEnd: string | null;
    cutoff: string | null;
    entryCount: number;
    scoringVersion: number;
  } | null> {
    const result = await this.pool.query<{
      ranked_count: number;
      lookback_start: string | null;
      lookback_end: string | null;
      cutoff: string | null;
      entry_count: number;
      scoring_version: number;
    }>(
      `select ranked_count, lookback_start, lookback_end, cutoff, entry_count, scoring_version
       from phasec_score_shadow where id = 1`,
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      rankedCount: Number(row.ranked_count),
      lookbackStart: row.lookback_start,
      lookbackEnd: row.lookback_end,
      cutoff: row.cutoff,
      entryCount: Number(row.entry_count),
      scoringVersion: Number(row.scoring_version),
    };
  }

  async markPaperClosed(): Promise<void> {
    await this.pool.query(
      `insert into phasec_score_shadow
        (id, ranked_count, entry_count, scoring_version, test_closed, updated_at)
       values (1, 0, 0, 3, true, now())
       on conflict (id) do update set test_closed = true, updated_at = now()`,
    );
  }

  async wallets(): Promise<TierWallet[]> {
    const result = await this.pool.query<{ address: string; hit_rate: number; size_tier: string }>(
      "select address, hit_rate, size_tier from tracked_wallet where active = true",
    );
    return result.rows.map((row) => ({
      address: row.address,
      hitRate: Number(row.hit_rate),
      tier: row.size_tier === "high" ? "high" : "base",
    }));
  }

  async pendingTiers(): Promise<string[]> {
    const result = await this.pool.query<{ wallet: string }>(
      "select wallet from phasec_tier_request where status = 'pending'",
    );
    return result.rows.map((row) => row.wallet);
  }

  async insertTier(wallet: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into phasec_tier_request (wallet, from_tier, to_tier, status, requested_at)
       select $1, 'base', 'high', 'pending', $2
       where not exists (
         select 1 from phasec_tier_request where wallet = $1 and status = 'pending'
       )`,
      [wallet, at.toISOString()],
    );
  }

  async activeAddresses(): Promise<string[]> {
    const result = await this.pool.query<{ address: string }>(
      "select address from tracked_wallet where active = true order by address",
    );
    return result.rows.map((row) => row.address);
  }

  async snapshot(): Promise<string[]> {
    const result = await this.pool.query<{ address: string }>(
      "select address from phasec_wallet_snapshot order by address",
    );
    return result.rows.map((row) => row.address);
  }

  async replaceSnapshot(addresses: readonly string[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query("delete from phasec_wallet_snapshot");
      for (const address of addresses) {
        await client.query("insert into phasec_wallet_snapshot (address) values ($1)", [address]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async weeklyExists(week: string): Promise<boolean> {
    const result = await this.pool.query("select 1 from phasec_weekly where week_start = $1", [
      week,
    ]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  async saveWeekly(week: string, body: string, at: Date): Promise<void> {
    await this.pool.query(
      `insert into phasec_weekly (week_start, body, created_at) values ($1, $2, $3)
       on conflict (week_start) do nothing`,
      [week, body, at.toISOString()],
    );
  }

  async resolvedReturns(): Promise<ResolvedReturn[]> {
    const result = await this.pool.query<{
      closed_at: Date;
      arm: PaperArm;
      net_return: number;
      size_pct: number;
    }>(
      `select closed_at, arm, net_return, size_pct from phasec_position
       where status = 'closed' and net_return is not null and closed_at is not null
         and restarted_at is null
       order by closed_at`,
    );
    return result.rows.map((row) => ({
      at: date(row.closed_at),
      arm: row.arm,
      net: Number(row.net_return),
      sizePct: Number(row.size_pct),
    }));
  }

  async graduatedMints(limit: number): Promise<string[]> {
    const result = await this.pool.query<{ mint: string }>(
      `select mint from candidates
       where graduated_at is not null
         and graduated_at <= now() - interval '24 hours'
         and graduated_at >= now() - interval '30 days'
       order by graduated_at desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => row.mint);
  }

  async saveAutobuyIntents(
    rows: readonly {
      kind: "entry" | "exit";
      mint: string;
      arm: string;
      stage: string;
      sizeUsd: number | null;
      quotePrice: number | null;
      expectedOut: string | null;
      slippageBps: number | null;
      reason: string;
      simulated: "ok" | "err" | "skipped";
    }[],
    at: Date,
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `insert into autobuy_intent
          (kind, mint, arm, stage, size_usd, quote_price, expected_out, slippage_bps, reason, simulated, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          row.kind,
          row.mint,
          row.arm,
          row.stage,
          row.sizeUsd,
          row.quotePrice,
          row.expectedOut,
          row.slippageBps,
          row.reason,
          row.simulated,
          at.toISOString(),
        ],
      );
    }
  }

  async autobuySpentSince(start: Date): Promise<number> {
    const result = await this.pool.query<{ spent: string | null }>(
      `select coalesce(sum(size_usd), 0)::text as spent from autobuy_intent
       where kind = 'entry' and reason = 'dry_run' and created_at >= $1`,
      [start.toISOString()],
    );
    return Number(result.rows[0]?.spent ?? 0);
  }

  async autobuyReview(): Promise<{ entries: number; exits: number }> {
    const result = await this.pool.query<{ kind: string; count: string }>(
      "select kind, count(*)::text as count from autobuy_intent group by kind",
    );
    const counts = { entries: 0, exits: 0 };
    for (const row of result.rows) {
      if (row.kind === "entry") counts.entries = Number(row.count);
      if (row.kind === "exit") counts.exits = Number(row.count);
    }
    return counts;
  }
}
