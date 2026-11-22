import pg from "pg";

import {
  planCandidateWrites,
  type CandidateDraft,
  type CurveMark,
  type GraduationMark,
} from "../ingest/apply.js";
import {
  allowanceCredits,
  formatCredits,
  intakeAllowanceCredits,
  MICROS_PER_CREDIT,
  projectMonthlyCredits,
  utcMonth,
  type HeliusPlan,
} from "../ingest/budget.js";
import type { DecodeFailure, Observation } from "../ingest/decode.js";
import type { FrameHourRow } from "../ingest/frameStats.js";
import { stratifyBackfillMints } from "../ingest/earlyBuyers.js";
import { SCORING_VERSION, walletCreditCapMicros } from "../ingest/wallets.js";
import {
  DLMM_PROGRAM_ID,
  LAUNCHLAB_PROGRAMS,
  METEORA_LAUNCH_PROGRAMS,
  PUMP_PROGRAMS,
  programsForVenue,
  type IngestVenue,
} from "../ingest/programs.js";
import {
  monthUsedPercent,
  formatIngestStatus,
  formatSpotCheck,
  type SpotCheckRow,
} from "../ingest/statusText.js";

const MIGRATION = `
create table if not exists schema_migrations (
  id text primary key,
  applied_at timestamptz not null default now()
);

create table if not exists raw_events (
  id bigserial primary key,
  signature text not null,
  event_index integer not null,
  slot bigint not null,
  program_id text not null,
  event_kind text not null,
  mint text,
  pool text,
  payload jsonb not null,
  byte_length integer not null,
  received_at timestamptz not null default now(),
  unique (signature, event_index)
);

create index if not exists raw_events_received_idx on raw_events (received_at desc);
create index if not exists raw_events_mint_kind_idx on raw_events (mint, event_kind);

create table if not exists candidates (
  id bigserial primary key,
  mint text not null,
  pool text not null unique,
  pool_type text not null,
  creator_wallet text,
  first_seen_slot bigint not null,
  first_seen_at timestamptz not null,
  source_signature text not null,
  curve_completed_slot bigint,
  curve_completed_at timestamptz,
  graduated_pool text,
  graduated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists candidates_mint_idx on candidates (mint, first_seen_at);

create table if not exists ingest_status (
  id integer primary key,
  state text not null,
  ws_method text not null,
  plan text not null,
  mode text not null,
  paused_nonessential boolean not null default false,
  last_slot bigint,
  last_error text,
  updated_at timestamptz not null default now(),
  constraint ingest_status_singleton check (id = 1)
);

create table if not exists ingest_daily (
  day date primary key,
  streamed_bytes bigint not null default 0,
  messages integer not null default 0,
  stored_events integer not null default 0,
  credit_micros bigint not null default 0
);

create table if not exists ingest_month (
  month text primary key,
  credit_micros bigint not null default 0,
  alerted_60 boolean not null default false,
  alerted_80 boolean not null default false,
  paused boolean not null default false
);

create table if not exists ingest_checkpoint (
  program_id text primary key,
  signature text not null,
  slot bigint not null,
  updated_at timestamptz not null default now()
);

alter table ingest_status add column if not exists soak_started_at timestamptz;
alter table ingest_status add column if not exists credits_since_start bigint not null default 0;

create table if not exists decode_failure (
  id bigserial primary key,
  signature text not null,
  slot bigint not null,
  program_id text not null,
  instruction_name text not null default '',
  error text not null,
  observed_at timestamptz not null default now(),
  unique (signature, slot, program_id, instruction_name, error)
);

create index if not exists decode_failure_observed_idx on decode_failure (observed_at desc);

create table if not exists ingest_backfill (
  id bigserial primary key,
  observed_at timestamptz not null,
  program_id text not null,
  gap_seconds integer,
  gap_slots bigint,
  events_recovered integer not null,
  pages_fetched integer not null,
  signatures_seen integer not null,
  transactions_fetched integer not null,
  reached_checkpoint boolean not null,
  credit_cap_hit boolean not null
);

create index if not exists ingest_backfill_observed_idx on ingest_backfill (observed_at desc);

alter table ingest_backfill add column if not exists unrecovered boolean not null default false;
alter table ingest_backfill add column if not exists gap_from_slot bigint;
alter table ingest_backfill add column if not exists gap_to_slot bigint;
alter table ingest_backfill add column if not exists reason text;

create table if not exists ingest_heap_sample (
  id bigserial primary key,
  sampled_at timestamptz not null,
  uptime_sec integer not null,
  rss_bytes bigint not null,
  heap_total_bytes bigint not null,
  heap_used_bytes bigint not null,
  external_bytes bigint not null,
  array_buffers_bytes bigint not null
);

create index if not exists ingest_heap_sample_uptime_idx on ingest_heap_sample (uptime_sec);

alter table raw_events add column if not exists source text not null default 'stream';
alter table candidates add column if not exists source text not null default 'stream';

create table if not exists ingest_frame_hourly (
  hour timestamptz not null,
  kind text not null,
  drop_reason text not null default '',
  received integer not null default 0,
  queued integer not null default 0,
  dropped integer not null default 0,
  shadow_dropped integer not null default 0,
  bytes bigint not null default 0,
  max_queue_depth integer not null default 0,
  max_handle_ms integer not null default 0,
  p99_handle_ms integer not null default 0,
  slots_seen integer not null default 0,
  slot_gaps integer not null default 0,
  primary key (hour, kind, drop_reason)
);

create table if not exists ingest_recall_audit (
  id bigserial primary key,
  ran_at timestamptz not null,
  program_id text not null,
  window_start_slot bigint not null,
  window_end_slot bigint not null,
  expected integer not null,
  matched integer not null,
  missed integer not null,
  recovered integer not null,
  decode_failed integer not null,
  credits integer not null,
  incomplete boolean not null default false
);

alter table ingest_recall_audit add column if not exists errored boolean not null default false;
alter table ingest_recall_audit add column if not exists error_reason text;
alter table ingest_recall_audit add column if not exists skipped boolean not null default false;

alter table ingest_status add column if not exists venue text;
alter table ingest_status add column if not exists coverage_slot bigint;

create table if not exists ingest_venue_coverage (
  venue text primary key,
  coverage_slot bigint not null,
  updated_at timestamptz not null default now()
);

insert into ingest_venue_coverage (venue, coverage_slot)
select venue, coverage_slot from ingest_status
where id = 1
  and venue in ('pump', 'launchlab', 'meteora')
  and coverage_slot is not null
on conflict (venue) do nothing;

create table if not exists ingest_venue_daily (
  venue text not null,
  day date not null,
  credit_micros bigint not null default 0,
  stored_events integer not null default 0,
  primary key (venue, day)
);

create table if not exists ingest_coin (
  mint text primary key,
  venue text not null,
  launchpad text not null,
  platform_config text,
  quote_mint text,
  transfer_fee_bps integer,
  pool text,
  creator text,
  created_slot bigint not null,
  created_at timestamptz not null,
  signature text not null
);

create table if not exists ingest_asset (
  chain text not null,
  address text not null,
  launchpad text not null,
  quote_address text,
  tax_bps integer,
  buy_tax_bps integer,
  sell_tax_bps integer,
  pool text,
  cl_pool_id text,
  creator text,
  created_block bigint,
  created_at timestamptz not null,
  tx_hash text not null,
  primary key (chain, address)
);

create table if not exists ingest_chain_checkpoint (
  chain text primary key,
  block_number bigint not null,
  coverage_block bigint,
  reconnects integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table ingest_chain_checkpoint add column if not exists reconnects integer not null default 0;

create table if not exists ingest_asset_enrich (
  chain text not null,
  address text not null,
  attempt integer not null,
  due_at timestamptz not null,
  primary key (chain, address)
);

create index if not exists ingest_asset_enrich_due_idx on ingest_asset_enrich (due_at);

create table if not exists tracked_wallet (
  address text primary key,
  hit_rate double precision not null,
  early_entries integer not null,
  early_wins integer not null,
  derivation text not null,
  active boolean not null,
  selected_at timestamptz not null,
  scoring_version integer not null default 1
);

alter table tracked_wallet add column if not exists scoring_version integer not null default 1;

create table if not exists wallet_fill (
  signature text not null,
  event_index integer not null,
  slot bigint not null,
  mint text not null,
  wallet text not null,
  side text not null,
  venue text not null,
  primary key (signature, event_index, wallet)
);

create table if not exists coin_wallet_signal (
  mint text primary key,
  tracked_buyers integer not null,
  tracked_buys integer not null,
  tracked_sells integer not null,
  updated_at timestamptz not null
);

create table if not exists coin_x_mention (
  post_url text primary key,
  mint text,
  ticker text,
  handle text not null,
  mentioned_at timestamptz not null,
  source text not null
);

create table if not exists ingest_feature_daily (
  feature text not null,
  day date not null,
  credit_micros bigint not null default 0,
  stored_events integer not null default 0,
  primary key (feature, day)
);

create table if not exists wallet_early_buy (
  signature text not null,
  event_index integer not null,
  slot bigint not null,
  mint text not null,
  wallet text not null,
  side text not null,
  venue text not null,
  is_creator boolean not null default false,
  primary key (signature, event_index, wallet)
);

create index if not exists wallet_early_buy_mint_idx on wallet_early_buy (mint);
alter table wallet_early_buy add column if not exists sol_amount double precision;
alter table wallet_early_buy add column if not exists token_amount double precision;
alter table wallet_early_buy add column if not exists block_time bigint;
alter table wallet_early_buy add column if not exists funder text;
alter table wallet_early_buy add column if not exists delayed_mark_usd double precision;
alter table wallet_early_buy add column if not exists delayed_mark_at timestamptz;
alter table wallet_early_buy add column if not exists delayed_mark_source text;
alter table wallet_early_buy add column if not exists exit_mark_usd double precision;
alter table wallet_early_buy add column if not exists bought_at timestamptz;
alter table wallet_early_buy add column if not exists exit_mark_at timestamptz;
alter table wallet_fill add column if not exists sol_amount double precision;
alter table wallet_fill add column if not exists token_amount double precision;
alter table wallet_fill add column if not exists block_time bigint;
create table if not exists phasec_score_shadow (
  id integer primary key,
  ranked_count integer not null,
  lookback_start text,
  lookback_end text,
  cutoff text,
  entry_count integer not null default 0,
  scoring_version integer not null,
  test_closed boolean not null default false,
  updated_at timestamptz not null,
  constraint phasec_score_shadow_one check (id = 1)
);

create table if not exists wallet_backfill_mint (
  mint text primary key,
  venue text not null,
  account text not null,
  status text not null,
  pagination_token text,
  buys_kept integer not null default 0,
  pages integer not null default 0,
  credits integer not null default 0,
  failures integer not null default 0,
  last_error text,
  updated_at timestamptz not null
);

alter table wallet_backfill_mint add column if not exists failures integer not null default 0;
alter table wallet_backfill_mint add column if not exists last_error text;
alter table wallet_backfill_mint add column if not exists mark_reread boolean not null default false;

create table if not exists wallet_job (
  id integer primary key,
  finished_at timestamptz
);

create table if not exists ingest_chain_event (
  chain text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number bigint not null,
  event_name text not null,
  address text not null,
  primary key (chain, tx_hash, log_index)
);

create table if not exists ingest_chain_audit (
  id bigserial primary key,
  chain text not null,
  ran_at timestamptz not null,
  from_block bigint not null,
  to_block bigint not null,
  expected integer not null,
  matched integer not null,
  missed integer not null
);

create table if not exists pump_coin (
  mint text primary key,
  bonding_curve text not null,
  creator text,
  created_slot bigint not null,
  created_at timestamptz not null,
  signature text not null
);

create table if not exists pump_trade (
  signature text not null,
  event_index integer not null,
  slot bigint not null,
  mint text not null,
  side text not null,
  trader text,
  is_creator boolean not null default false,
  reason text not null,
  primary key (signature, event_index)
);

create index if not exists pump_trade_mint_slot_idx on pump_trade (mint, slot);
create index if not exists wallet_fill_mint_idx on wallet_fill (mint);
create index if not exists candidates_recent_idx on candidates (first_seen_at desc);
create index if not exists candidates_graduated_idx on candidates (graduated_at desc) where graduated_at is not null;

create table if not exists pump_coin_stats (
  mint text primary key,
  buys integer not null default 0,
  sells integer not null default 0,
  creator_sells integer not null default 0,
  last_slot bigint not null,
  updated_at timestamptz not null
);

create index if not exists ingest_recall_audit_ran_idx on ingest_recall_audit (ran_at desc);

alter table tracked_wallet add column if not exists size_tier text not null default 'base';

create table if not exists phasec_protocol (
  id integer primary key,
  fingerprint text not null,
  body text not null,
  registered_at timestamptz not null,
  constraint phasec_protocol_singleton check (id = 1)
);

create table if not exists phasec_alert (
  id bigserial primary key,
  mint text not null,
  stage text not null,
  arm text not null,
  kind text not null,
  created_at timestamptz not null,
  delivered_at timestamptz,
  held_reason text,
  size_pct double precision,
  strength double precision,
  body text not null
);

create index if not exists phasec_alert_created_idx on phasec_alert (created_at desc);

create table if not exists phasec_position (
  id bigserial primary key,
  mint text not null,
  stage text not null,
  arm text not null,
  status text not null,
  alert_at timestamptz not null,
  entry_after timestamptz not null,
  opened_at timestamptz,
  entry_quote double precision,
  exit_quote double precision,
  closed_at timestamptz,
  exit_reason text,
  net_return double precision,
  size_pct double precision not null,
  exit_plan text not null,
  screen_failed boolean not null default false,
  entry_impact_pct double precision,
  entry_fee_usd double precision,
  entry_size_usd double precision,
  exit_impact_pct double precision,
  exit_fee_usd double precision,
  net_return_2x double precision,
  quote_failure text,
  exit_treatment text
);

alter table phasec_position add column if not exists entry_impact_pct double precision;
alter table phasec_position add column if not exists entry_fee_usd double precision;
alter table phasec_position add column if not exists entry_size_usd double precision;
alter table phasec_position add column if not exists exit_impact_pct double precision;
alter table phasec_position add column if not exists exit_fee_usd double precision;
alter table phasec_position add column if not exists net_return_2x double precision;
alter table phasec_position add column if not exists quote_failure text;
alter table phasec_position add column if not exists exit_treatment text;

create index if not exists phasec_position_status_idx on phasec_position (status);

create table if not exists phasec_pause (
  day date primary key,
  reason text not null,
  paused_at timestamptz not null
);

create table if not exists phasec_tier_request (
  id bigserial primary key,
  wallet text not null,
  from_tier text not null,
  to_tier text not null,
  status text not null,
  requested_at timestamptz not null
);

create unique index if not exists phasec_tier_pending_idx
  on phasec_tier_request (wallet) where status = 'pending';

create table if not exists phasec_weekly (
  week_start date primary key,
  body text not null,
  created_at timestamptz not null
);

create table if not exists phasec_wallet_snapshot (
  address text primary key
);

alter table phasec_position add column if not exists entry_out_amount text;
alter table phasec_position add column if not exists sell_warned boolean not null default false;
alter table phasec_position add column if not exists scaled_at timestamptz;
alter table phasec_position add column if not exists fomo_fee_usd double precision;
alter table phasec_position add column if not exists quote_source text;
alter table phasec_position add column if not exists restarted_at timestamptz;
alter table phasec_alert add column if not exists fingerprint text;
alter table phasec_alert add column if not exists tradable_in_fomo boolean;
alter table phasec_alert add column if not exists minutes_from_alert_to_listed double precision;
alter table phasec_alert add column if not exists restarted_at timestamptz;
create index if not exists wallet_fill_mint_side_idx on wallet_fill (mint, side);

create table if not exists phasec_mint_cache (
  mint text primary key,
  mint_authority_active boolean,
  freeze_authority_active boolean,
  top10_pct double precision,
  sniper_pct double precision,
  curve_liquidity_usd double precision,
  exit_impact_pct double precision,
  exit_impact_at timestamptz,
  fetched_at timestamptz not null
);
alter table phasec_mint_cache add column if not exists sniper_pct double precision;
alter table phasec_mint_cache add column if not exists curve_liquidity_usd double precision;

create table if not exists phasec_market_snapshot (
  mint text not null,
  polled_at timestamptz not null,
  price_usd double precision,
  liquidity_usd double precision,
  volume_1h double precision,
  volume_24h double precision,
  primary key (mint, polled_at)
);
alter table phasec_market_snapshot add column if not exists volume_24h double precision;
alter table phasec_mint_cache add column if not exists exit_impact_pct double precision;
alter table phasec_mint_cache add column if not exists exit_impact_at timestamptz;
alter table phasec_mint_cache add column if not exists top10_method text;
create index if not exists wallet_fill_slot_idx on wallet_fill (slot);

create table if not exists autobuy_intent (
  id bigserial primary key,
  kind text not null,
  mint text not null,
  arm text not null,
  stage text not null,
  size_usd double precision,
  quote_price double precision,
  expected_out text,
  slippage_bps integer,
  reason text not null,
  simulated text not null,
  created_at timestamptz not null
);
`;

export function createPool(
  databaseUrl: string,
  options?: { synchronousCommitOff?: boolean },
): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
    options: options?.synchronousCommitOff ? "-c synchronous_commit=off" : undefined,
  });
}

export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(MIGRATION);
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["001_ingest"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["002_liveness_backfill"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["003_unrecovered_gap"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["004_heap_sample"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["005_backfill_reason"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["006_frame_hourly"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["007_event_source"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["008_recall_audit"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["009_recall_error"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["010_pump_coin"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["011_audit_coverage"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["012_skip_stale_audits"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["013_multi_venue"],
    );
    const launchpadTags = await client.query("select 1 from schema_migrations where id = $1", [
      "014_launchpad_tags",
    ]);
    const firstLaunchpadTags = launchpadTags.rowCount === 0;
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["014_launchpad_tags"],
    );
    await client.query("delete from ingest_checkpoint where program_id = $1", [DLMM_PROGRAM_ID]);
    await client.query(`update ingest_coin set launchpad = 'Pump.fun' where launchpad = 'Pump'`);
    await client.query(`update ingest_coin set launchpad = 'BONK.fun' where launchpad = 'Bonk'`);
    await client.query(
      `update ingest_coin
       set launchpad = 'Raydium Launchlab'
       where platform_config = '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4'
         and launchpad = 'unknown'`,
    );
    await client.query(
      `update ingest_coin
       set launchpad = case platform_config
         when '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7' then 'StonkFun'
         when '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt' then 'StonkFun'
         when 'CUqSiwPs6C4WyntMgaFazLp7wYQfaLp5URbjUP9V7SNi' then 'StonkFun'
         when 'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1' then 'BONK.fun'
         when '82NMHVCKwehXgbXMyzL41mvv3sdkypaMCtTxvJ4CtTzm' then 'BONK.fun'
         when '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4' then 'Raydium Launchlab'
         else launchpad
       end
       where venue = 'launchlab'
         and platform_config in (
           '4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7',
           '6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt',
           'CUqSiwPs6C4WyntMgaFazLp7wYQfaLp5URbjUP9V7SNi',
           'FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1',
           '82NMHVCKwehXgbXMyzL41mvv3sdkypaMCtTxvJ4CtTzm',
           '4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4'
         )`,
    );
    if (firstLaunchpadTags) {
      await client.query(
        `delete from ingest_coin c
         where c.venue = 'meteora'
           and not exists (
             select 1 from raw_events e
             where e.mint = c.mint
               and e.event_kind in ('dbc_initialize', 'dbc_migration_damm_v2')
           )`,
      );
    }
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["015_bsc_flap"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["016_bsc_reliability"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["017_wallet_signal"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["018_wallet_backfill"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["019_wallet_balance"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["020_scoring_version"],
    );
    await client.query(
      "insert into schema_migrations (id) values ($1) on conflict (id) do nothing",
      ["021_phase_c"],
    );
    await client.query(
      `update ingest_recall_audit a
       set skipped = true,
           error_reason = 'before_coverage'
       from ingest_venue_coverage c
       where a.skipped = false
         and a.window_start_slot < c.coverage_slot
         and (
           (c.venue = 'pump' and a.program_id = any($1::text[]))
           or (c.venue = 'launchlab' and a.program_id = any($2::text[]))
           or (c.venue = 'meteora' and a.program_id = any($3::text[]))
         )`,
      [[...PUMP_PROGRAMS], [...LAUNCHLAB_PROGRAMS], [...METEORA_LAUNCH_PROGRAMS]],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export class IngestRepository {
  constructor(private readonly pool: pg.Pool) {}

  async insertRaw(
    observation: Observation,
    byteLength: number,
    receivedAt: Date,
    source: "stream" | "audit" = "stream",
  ): Promise<boolean> {
    const result = await this.pool.query(
      `insert into raw_events
        (signature, event_index, slot, program_id, event_kind, mint, pool, payload, byte_length, received_at, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
       on conflict (signature, event_index) do nothing`,
      [
        observation.signature,
        observation.eventIndex,
        observation.slot,
        observation.programId,
        observation.kind,
        observation.mint,
        observation.pool,
        JSON.stringify(eventPayload(observation)),
        byteLength,
        receivedAt.toISOString(),
        source,
      ],
    );
    return result.rowCount === 1;
  }

  /**
   * One transaction for the raw row, the candidate side effects, and the checkpoint.
   * The checkpoint cannot move ahead of the row. source 'audit' is stored and is not
   * a tradable or alertable launch.
   */
  async persistEvent(input: {
    observation: Observation;
    byteLength: number;
    receivedAt: Date;
    source: "stream" | "audit";
  }): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const inserted = await client.query(
        `insert into raw_events
          (signature, event_index, slot, program_id, event_kind, mint, pool, payload, byte_length, received_at, source)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
         on conflict (signature, event_index) do nothing`,
        [
          input.observation.signature,
          input.observation.eventIndex,
          input.observation.slot,
          input.observation.programId,
          input.observation.kind,
          input.observation.mint,
          input.observation.pool,
          JSON.stringify(eventPayload(input.observation)),
          input.byteLength,
          input.receivedAt.toISOString(),
          input.source,
        ],
      );
      if (inserted.rowCount !== 1) {
        await client.query("commit");
        return false;
      }
      const seenAt = input.observation.blockTimeMs ?? input.receivedAt.getTime();
      let earliest: number | null = null;
      if (input.observation.mint) {
        const prior = await client.query<{ first_seen_at: Date }>(
          `select c.first_seen_at
           from candidates c
           where c.mint = $1
           order by c.first_seen_at asc
           limit 1`,
          [input.observation.mint],
        );
        const value = prior.rows[0]?.first_seen_at;
        earliest = value ? new Date(value).getTime() : null;
      }
      const plan = planCandidateWrites({
        observation: input.observation,
        nowMs: seenAt,
        earliestFirstSeenMs: earliest,
      });
      if (plan.candidate) {
        await client.query(
          `insert into candidates
            (mint, pool, pool_type, creator_wallet, first_seen_slot, first_seen_at, source_signature, source)
           values ($1,$2,$3,$4,$5,$6,$7,$8)
           on conflict (pool) do nothing`,
          [
            plan.candidate.mint,
            plan.candidate.pool,
            plan.candidate.poolType,
            plan.candidate.creatorWallet,
            plan.candidate.firstSeenSlot,
            new Date(plan.candidate.firstSeenAtMs).toISOString(),
            plan.candidate.sourceSignature,
            input.source,
          ],
        );
      }
      if (plan.curve) {
        await client.query(
          `update candidates
           set curve_completed_slot = $2, curve_completed_at = $3
           where pool = $1 and curve_completed_slot is null`,
          [plan.curve.pool, plan.curve.slot, new Date(plan.curve.atMs).toISOString()],
        );
      }
      if (plan.graduation) {
        await client.query(
          `update candidates
           set graduated_pool = $2, graduated_at = $3
           where pool = $1 and graduated_pool is null`,
          [
            plan.graduation.virtualPool,
            plan.graduation.graduatedPool,
            new Date(plan.graduation.atMs).toISOString(),
          ],
        );
      }
      await client.query(
        `insert into ingest_checkpoint (program_id, signature, slot, updated_at)
         values ($1,$2,$3,$4)
         on conflict (program_id) do update set
           signature = excluded.signature,
           slot = excluded.slot,
           updated_at = excluded.updated_at
         where excluded.slot >= ingest_checkpoint.slot`,
        [
          input.observation.programId,
          input.observation.signature,
          input.observation.slot,
          input.receivedAt.toISOString(),
        ],
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async insertCandidate(candidate: CandidateDraft): Promise<void> {
    await this.pool.query(
      `insert into candidates
        (mint, pool, pool_type, creator_wallet, first_seen_slot, first_seen_at, source_signature)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (pool) do nothing`,
      [
        candidate.mint,
        candidate.pool,
        candidate.poolType,
        candidate.creatorWallet,
        candidate.firstSeenSlot,
        new Date(candidate.firstSeenAtMs).toISOString(),
        candidate.sourceSignature,
      ],
    );
  }

  async markCurve(mark: CurveMark): Promise<void> {
    await this.pool.query(
      `update candidates
       set curve_completed_slot = $2, curve_completed_at = $3
       where pool = $1 and curve_completed_slot is null`,
      [mark.pool, mark.slot, new Date(mark.atMs).toISOString()],
    );
  }

  async markGraduation(mark: GraduationMark): Promise<void> {
    await this.pool.query(
      `update candidates
       set graduated_pool = $2, graduated_at = $3
       where pool = $1 and graduated_pool is null`,
      [mark.virtualPool, mark.graduatedPool, new Date(mark.atMs).toISOString()],
    );
  }

  async earliestFirstSeenMs(mint: string): Promise<number | null> {
    const result = await this.pool.query<{ first_seen_at: Date }>(
      "select first_seen_at from candidates where mint = $1 order by first_seen_at asc limit 1",
      [mint],
    );
    const value = result.rows[0]?.first_seen_at;
    return value ? new Date(value).getTime() : null;
  }

  async addUsage(input: {
    now: Date;
    streamedBytes: bigint;
    messages: number;
    storedEvents: number;
    creditMicros: bigint;
    venue?: string;
  }): Promise<void> {
    const day = input.now.toISOString().slice(0, 10);
    const month = utcMonth(input.now);
    await this.pool.query(
      `insert into ingest_daily (day, streamed_bytes, messages, stored_events, credit_micros)
       values ($1,$2,$3,$4,$5)
       on conflict (day) do update set
         streamed_bytes = ingest_daily.streamed_bytes + excluded.streamed_bytes,
         messages = ingest_daily.messages + excluded.messages,
         stored_events = ingest_daily.stored_events + excluded.stored_events,
         credit_micros = ingest_daily.credit_micros + excluded.credit_micros`,
      [
        day,
        input.streamedBytes.toString(),
        input.messages,
        input.storedEvents,
        input.creditMicros.toString(),
      ],
    );
    await this.pool.query(
      `insert into ingest_month (month, credit_micros)
       values ($1,$2)
       on conflict (month) do update set
         credit_micros = ingest_month.credit_micros + excluded.credit_micros`,
      [month, input.creditMicros.toString()],
    );
    await this.pool.query(
      `insert into ingest_status
        (id, state, ws_method, plan, mode, soak_started_at, credits_since_start, updated_at)
       values (1, 'starting', 'parsed', 'developer', 'dry-run', $2, $1, $2)
       on conflict (id) do update set
         credits_since_start = ingest_status.credits_since_start + excluded.credits_since_start,
         soak_started_at = coalesce(ingest_status.soak_started_at, excluded.soak_started_at)`,
      [input.creditMicros.toString(), input.now.toISOString()],
    );
    if (input.venue && input.creditMicros !== 0n) {
      await this.addVenueCredits(input.now, input.venue, input.creditMicros, input.storedEvents);
    }
  }

  private async addVenueCredits(
    now: Date,
    venue: string,
    creditMicros: bigint,
    storedEvents: number,
  ): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    await this.pool.query(
      `insert into ingest_venue_daily (venue, day, credit_micros, stored_events)
       values ($1,$2,$3,$4)
       on conflict (venue, day) do update set
         credit_micros = ingest_venue_daily.credit_micros + excluded.credit_micros,
         stored_events = ingest_venue_daily.stored_events + excluded.stored_events`,
      [venue, day, creditMicros.toString(), storedEvents],
    );
  }

  async flushAccounting(input: {
    now: Date;
    streamedBytes: bigint;
    messages: number;
    storedEvents: number;
    creditMicros: bigint;
    frames: readonly FrameHourRow[];
    venueCredits?: Readonly<Record<string, bigint>>;
    venueStored?: Readonly<Record<string, number>>;
    featureCredits?: Readonly<Record<string, bigint>>;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const day = input.now.toISOString().slice(0, 10);
      const month = utcMonth(input.now);
      if (
        input.streamedBytes !== 0n ||
        input.messages !== 0 ||
        input.storedEvents !== 0 ||
        input.creditMicros !== 0n
      ) {
        await client.query(
          `insert into ingest_daily (day, streamed_bytes, messages, stored_events, credit_micros)
           values ($1,$2,$3,$4,$5)
           on conflict (day) do update set
             streamed_bytes = ingest_daily.streamed_bytes + excluded.streamed_bytes,
             messages = ingest_daily.messages + excluded.messages,
             stored_events = ingest_daily.stored_events + excluded.stored_events,
             credit_micros = ingest_daily.credit_micros + excluded.credit_micros`,
          [
            day,
            input.streamedBytes.toString(),
            input.messages,
            input.storedEvents,
            input.creditMicros.toString(),
          ],
        );
        await client.query(
          `insert into ingest_month (month, credit_micros)
           values ($1,$2)
           on conflict (month) do update set
             credit_micros = ingest_month.credit_micros + excluded.credit_micros`,
          [month, input.creditMicros.toString()],
        );
        await client.query(
          `insert into ingest_status
            (id, state, ws_method, plan, mode, soak_started_at, credits_since_start, updated_at)
           values (1, 'starting', 'parsed', 'developer', 'dry-run', $2, $1, $2)
           on conflict (id) do update set
             credits_since_start = ingest_status.credits_since_start + excluded.credits_since_start,
             soak_started_at = coalesce(ingest_status.soak_started_at, excluded.soak_started_at)`,
          [input.creditMicros.toString(), input.now.toISOString()],
        );
      }
      const venueNames = new Set([
        ...Object.keys(input.venueCredits ?? {}),
        ...Object.keys(input.venueStored ?? {}),
      ]);
      for (const venue of venueNames) {
        const micros = input.venueCredits?.[venue] ?? 0n;
        const storedEvents = input.venueStored?.[venue] ?? 0;
        if (micros === 0n && storedEvents === 0) continue;
        const day = input.now.toISOString().slice(0, 10);
        await client.query(
          `insert into ingest_venue_daily (venue, day, credit_micros, stored_events)
           values ($1,$2,$3,$4)
           on conflict (venue, day) do update set
             credit_micros = ingest_venue_daily.credit_micros + excluded.credit_micros,
             stored_events = ingest_venue_daily.stored_events + excluded.stored_events`,
          [venue, day, micros.toString(), storedEvents],
        );
      }
      for (const [feature, micros] of Object.entries(input.featureCredits ?? {})) {
        if (micros === 0n) continue;
        const day = input.now.toISOString().slice(0, 10);
        await client.query(
          `insert into ingest_feature_daily (feature, day, credit_micros, stored_events)
           values ($1,$2,$3,0)
           on conflict (feature, day) do update set
             credit_micros = ingest_feature_daily.credit_micros + excluded.credit_micros`,
          [feature, day, micros.toString()],
        );
      }
      for (const row of input.frames) {
        await client.query(
          `insert into ingest_frame_hourly
            (hour, kind, drop_reason, received, queued, dropped, shadow_dropped, bytes,
             max_queue_depth, max_handle_ms, p99_handle_ms, slots_seen, slot_gaps)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (hour, kind, drop_reason) do update set
             received = ingest_frame_hourly.received + excluded.received,
             queued = ingest_frame_hourly.queued + excluded.queued,
             dropped = ingest_frame_hourly.dropped + excluded.dropped,
             shadow_dropped = ingest_frame_hourly.shadow_dropped + excluded.shadow_dropped,
             bytes = ingest_frame_hourly.bytes + excluded.bytes,
             max_queue_depth = greatest(ingest_frame_hourly.max_queue_depth, excluded.max_queue_depth),
             max_handle_ms = greatest(ingest_frame_hourly.max_handle_ms, excluded.max_handle_ms),
             p99_handle_ms = greatest(ingest_frame_hourly.p99_handle_ms, excluded.p99_handle_ms),
             slots_seen = ingest_frame_hourly.slots_seen + excluded.slots_seen,
             slot_gaps = ingest_frame_hourly.slot_gaps + excluded.slot_gaps`,
          [
            row.hour,
            row.kind,
            row.dropReason,
            row.received,
            row.queued,
            row.dropped,
            row.shadowDropped,
            row.bytes.toString(),
            row.maxQueueDepth,
            row.maxHandleMs,
            row.p99HandleMs,
            row.slotsSeen,
            row.slotGaps,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async monthUsage(now: Date): Promise<{
    creditMicros: bigint;
    alerted60: boolean;
    alerted80: boolean;
    paused: boolean;
  }> {
    const result = await this.pool.query<{
      credit_micros: string;
      alerted_60: boolean;
      alerted_80: boolean;
      paused: boolean;
    }>("select credit_micros, alerted_60, alerted_80, paused from ingest_month where month = $1", [
      utcMonth(now),
    ]);
    const row = result.rows[0];
    if (!row) {
      return { creditMicros: 0n, alerted60: false, alerted80: false, paused: false };
    }
    return {
      creditMicros: BigInt(row.credit_micros),
      alerted60: row.alerted_60,
      alerted80: row.alerted_80,
      paused: row.paused,
    };
  }

  async markBudgetAlert(now: Date, level: "warn60" | "warn80" | "pause"): Promise<void> {
    const column = level === "warn60" ? "alerted_60" : level === "warn80" ? "alerted_80" : "paused";
    await this.pool.query(
      `insert into ingest_month (month, ${column}) values ($1, true)
       on conflict (month) do update set ${column} = true`,
      [utcMonth(now)],
    );
  }

  async clearPause(now: Date): Promise<void> {
    await this.pool.query("update ingest_month set paused = false where month = $1", [
      utcMonth(now),
    ]);
  }

  async writeStatus(input: {
    state: string;
    wsMethod: string;
    plan: string;
    mode: string;
    paused: boolean;
    lastSlot: number | null;
    lastError: string | null;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_status
        (id, state, ws_method, plan, mode, paused_nonessential, last_slot, last_error, updated_at)
       values (1,$1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set
         state = excluded.state,
         ws_method = excluded.ws_method,
         plan = excluded.plan,
         mode = excluded.mode,
         paused_nonessential = excluded.paused_nonessential,
         last_slot = coalesce(excluded.last_slot, ingest_status.last_slot),
         last_error = excluded.last_error,
         updated_at = excluded.updated_at,
         soak_started_at = coalesce(ingest_status.soak_started_at, excluded.updated_at)`,
      [
        input.state,
        input.wsMethod,
        input.plan,
        input.mode,
        input.paused,
        input.lastSlot,
        input.lastError,
        input.now.toISOString(),
      ],
    );
  }

  async insertDecodeFailure(failure: DecodeFailure, observedAt: Date): Promise<void> {
    const error = failure.error.slice(0, 500);
    const instructionName = (failure.instructionName ?? "").slice(0, 200);
    await this.pool.query(
      `insert into decode_failure
        (signature, slot, program_id, instruction_name, error, observed_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (signature, slot, program_id, instruction_name, error) do nothing`,
      [
        failure.signature,
        failure.slot,
        failure.programId,
        instructionName,
        error,
        observedAt.toISOString(),
      ],
    );
  }

  async insertBackfill(input: {
    observedAt: Date;
    programId: string;
    gapSeconds: number | null;
    gapSlots: number | null;
    eventsRecovered: number;
    pagesFetched: number;
    signaturesSeen: number;
    transactionsFetched: number;
    reachedCheckpoint: boolean;
    creditCapHit: boolean;
    unrecovered: boolean;
    gapFromSlot: number | null;
    gapToSlot: number | null;
    reason: string | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_backfill
        (observed_at, program_id, gap_seconds, gap_slots, events_recovered, pages_fetched,
         signatures_seen, transactions_fetched, reached_checkpoint, credit_cap_hit,
         unrecovered, gap_from_slot, gap_to_slot, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.observedAt.toISOString(),
        input.programId,
        input.gapSeconds,
        input.gapSlots,
        input.eventsRecovered,
        input.pagesFetched,
        input.signaturesSeen,
        input.transactionsFetched,
        input.reachedCheckpoint,
        input.creditCapHit,
        input.unrecovered,
        input.gapFromSlot,
        input.gapToSlot,
        input.reason,
      ],
    );
  }

  async clearCheckpoint(programId: string): Promise<void> {
    await this.pool.query("delete from ingest_checkpoint where program_id = $1", [programId]);
  }

  async lastLiveSlot(): Promise<number | null> {
    return (await this.ingestCursor()).slot;
  }

  async ingestCursor(): Promise<{
    slot: number | null;
    venue: string | null;
    coverageSlot: number | null;
  }> {
    const result = await this.pool.query<{
      last_slot: string | null;
      venue: string | null;
      coverage_slot: string | null;
    }>("select last_slot, venue, coverage_slot from ingest_status where id = 1");
    const row = result.rows[0];
    const slot = row?.last_slot == null ? null : Number(row.last_slot);
    const coverage = row?.coverage_slot == null ? null : Number(row.coverage_slot);
    return {
      slot: slot !== null && Number.isFinite(slot) ? slot : null,
      venue: row?.venue ?? null,
      coverageSlot: coverage !== null && Number.isFinite(coverage) ? coverage : null,
    };
  }

  async recordVenueCoverage(input: {
    venue: string;
    coverageSlot: number;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_venue_coverage (venue, coverage_slot, updated_at)
       values ($1, $2, $3)
       on conflict (venue) do update set
         coverage_slot = excluded.coverage_slot,
         updated_at = excluded.updated_at`,
      [input.venue, input.coverageSlot, input.now.toISOString()],
    );
  }

  async venueCoverages(): Promise<Map<string, number>> {
    const result = await this.pool.query<{ venue: string; coverage_slot: string }>(
      "select venue, coverage_slot from ingest_venue_coverage",
    );
    const out = new Map<string, number>();
    for (const row of result.rows) {
      const slot = Number(row.coverage_slot);
      if (Number.isFinite(slot)) out.set(row.venue, slot);
    }
    return out;
  }

  async rememberCoin(input: {
    mint: string;
    venue: string;
    launchpad: string;
    platformConfig: string | null;
    quoteMint: string | null;
    transferFeeBps: number | null;
    pool: string | null;
    creator: string | null;
    createdSlot: number;
    createdAt: Date;
    signature: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_coin
        (mint, venue, launchpad, platform_config, quote_mint, transfer_fee_bps, pool, creator,
         created_slot, created_at, signature)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (mint) do nothing`,
      [
        input.mint,
        input.venue,
        input.launchpad,
        input.platformConfig,
        input.quoteMint,
        input.transferFeeBps,
        input.pool,
        input.creator,
        input.createdSlot,
        input.createdAt.toISOString(),
        input.signature,
      ],
    );
  }

  async insertHeapSample(input: {
    sampledAt: Date;
    uptimeSec: number;
    rssBytes: number;
    heapTotalBytes: number;
    heapUsedBytes: number;
    externalBytes: number;
    arrayBuffersBytes: number;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_heap_sample
        (sampled_at, uptime_sec, rss_bytes, heap_total_bytes, heap_used_bytes, external_bytes, array_buffers_bytes)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.sampledAt.toISOString(),
        input.uptimeSec,
        input.rssBytes,
        input.heapTotalBytes,
        input.heapUsedBytes,
        input.externalBytes,
        input.arrayBuffersBytes,
      ],
    );
  }

  async knownSignatures(signatures: readonly string[]): Promise<Set<string>> {
    if (signatures.length === 0) return new Set();
    const result = await this.pool.query<{ signature: string }>(
      "select signature from raw_events where signature = any($1::text[])",
      [signatures],
    );
    return new Set(result.rows.map((row) => row.signature));
  }

  async checkpoint(programId: string): Promise<{ signature: string; slot: number } | null> {
    const result = await this.pool.query<{ signature: string; slot: string }>(
      "select signature, slot from ingest_checkpoint where program_id = $1",
      [programId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { signature: row.signature, slot: Number(row.slot) };
  }

  async saveCheckpoint(
    programId: string,
    signature: string,
    slot: number,
    now: Date,
  ): Promise<void> {
    await this.pool.query(
      `insert into ingest_checkpoint (program_id, signature, slot, updated_at)
       values ($1,$2,$3,$4)
       on conflict (program_id) do update set
         signature = excluded.signature,
         slot = excluded.slot,
         updated_at = excluded.updated_at
       where excluded.slot >= ingest_checkpoint.slot`,
      [programId, signature, slot, now.toISOString()],
    );
  }

  async recentEvents(limit: number): Promise<SpotCheckRow[]> {
    const result = await this.pool.query<{
      signature: string;
      slot: string;
      event_kind: string;
      mint: string | null;
      pool: string | null;
    }>(
      `select signature, slot, event_kind, mint, pool
       from raw_events
       order by received_at desc, id desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      signature: row.signature,
      slot: row.slot,
      kind: row.event_kind,
      mint: row.mint,
      pool: row.pool,
    }));
  }

  private async statusBody(input: {
    plan: HeliusPlan;
    allowanceOverride: number | undefined;
    now: Date;
  }): Promise<string> {
    const status = await this.pool.query<{
      state: string;
      ws_method: string;
      plan: string;
      mode: string;
      paused_nonessential: boolean;
      last_slot: string | null;
      updated_at: Date;
      soak_started_at: Date | null;
      credits_since_start: string | null;
    }>(
      `select state, ws_method, plan, mode, paused_nonessential, last_slot, updated_at,
              soak_started_at, credits_since_start
       from ingest_status where id = 1`,
    );
    const row = status.rows[0];
    const day = input.now.toISOString().slice(0, 10);
    const daily = await this.pool.query<{
      streamed_bytes: string;
      stored_events: number;
      credit_micros: string;
    }>("select streamed_bytes, stored_events, credit_micros from ingest_daily where day = $1", [
      day,
    ]);
    const month = await this.monthUsage(input.now);
    const allowance = intakeAllowanceCredits(input.allowanceOverride);
    const dailyRow = daily.rows[0];
    const soakStarted = row?.soak_started_at ? new Date(row.soak_started_at) : null;
    const elapsed = soakStarted ? input.now.getTime() - soakStarted.getTime() : 0;
    const creditsToday = BigInt(row?.credits_since_start ?? dailyRow?.credit_micros ?? "0");
    const updatedAt = row ? new Date(row.updated_at) : null;
    return formatIngestStatus({
      state: row?.state ?? "down",
      wsMethod: row?.ws_method ?? "none",
      plan: row?.plan ?? input.plan,
      mode: row?.mode ?? "dry-run",
      pausedNonEssential: month.paused,
      lastSlot: row?.last_slot ?? null,
      updatedAt: updatedAt?.toISOString() ?? null,
      eventsToday: dailyRow?.stored_events ?? 0,
      bytesToday: dailyRow?.streamed_bytes ?? "0",
      creditsToday: formatCredits(creditsToday),
      projected30d: projectMonthlyCredits({ creditsTodayMicros: creditsToday, elapsedMs: elapsed }),
      allowance: allowance.toString(),
      monthUsedPct: monthUsedPercent(month.creditMicros, allowance),
      stale: updatedAt === null || input.now.getTime() - updatedAt.getTime() > 90_000,
    });
  }

  async statusReport(input: {
    plan: HeliusPlan;
    allowanceOverride: number | undefined;
    now: Date;
  }): Promise<string> {
    const base = await this.statusBody(input);
    const since = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const cursor = await this.ingestCursor();
    const coverages = await this.venueCoverages();
    const venues: IngestVenue[] =
      coverages.size > 0
        ? [...coverages.keys()].filter(
            (venue): venue is IngestVenue =>
              venue === "pump" || venue === "launchlab" || venue === "meteora",
          )
        : [cursor.venue === "meteora" ? "meteora" : "pump"];
    const lines = [base];
    for (const venue of venues) {
      const coverageSlot = coverages.get(venue) ?? cursor.coverageSlot;
      const week = await this.recallTotals(since, {
        programIds: programsForVenue(venue),
        coverageSlot,
      });
      const unseen = await this.creationUnseen(venue, coverageSlot);
      const loss =
        week.expected === 0 ? "n/a" : `${((week.missed / week.expected) * 100).toFixed(2)}%`;
      lines.push(
        `${venue} recall loss 7d: ${loss} (${week.missed.toString()}/${week.expected.toString()})`,
        `${venue} creation unseen: ${unseen.toString()}`,
      );
    }
    const bsc = await this.chainCheckpoint("bsc");
    if (bsc) lines.push(`bsc reconnects: ${bsc.reconnects.toString()}`);
    const bscAudit = await this.latestChainAudit("bsc");
    if (bscAudit) {
      lines.push(
        `bsc recall: ${bscAudit.missed.toString()}/${bscAudit.expected.toString()} missed (${bscAudit.matched.toString()} matched)`,
      );
    }
    const configured = allowanceCredits(input.plan, input.allowanceOverride);
    const walletCap = walletCreditCapMicros(configured * MICROS_PER_CREDIT, 25);
    const walletSpent = await this.featureMonthMicros("wallet_subscribe", utcMonth(input.now));
    lines.push(
      `wallet_subscribe: ${formatCredits(walletSpent)} / ${formatCredits(walletCap)} ${walletSpent >= walletCap ? "stopped" : "open"}`,
    );
    return lines.join("\n");
  }

  async earlyBuys(): Promise<
    Array<{
      wallet: string;
      mint: string;
      side: "buy" | "sell";
      graduated: boolean;
      slot: number | null;
      createdSlot: number | null;
      createdAt: Date | null;
      venue: string | null;
      solAmount: number | null;
      tokenAmount: number | null;
      blockTimeSec: number | null;
      funder: string | null;
      delayedMarkUsd: number | null;
      delayedMarkSource: "jupiter" | "curve_modeled" | "history_swap" | null;
      exitMarkUsd: number | null;
      signature: string | null;
    }>
  > {
    const result = await this.pool.query<{
      wallet: string;
      mint: string;
      side: string;
      graduated: boolean;
      slot: string | null;
      created_slot: string | null;
      created_at: Date | null;
      venue: string | null;
      sol_amount: number | null;
      token_amount: number | null;
      block_time: string | null;
      funder: string | null;
      delayed_mark_usd: number | null;
      delayed_mark_source: string | null;
      exit_mark_usd: number | null;
      signature: string | null;
    }>(
      `select t.wallet, t.mint, t.side, t.slot, c.created_slot, c.created_at, c.venue,
              t.sol_amount, t.token_amount, t.block_time, t.funder,
              t.delayed_mark_usd, t.delayed_mark_source, t.exit_mark_usd, t.signature,
              exists (
                select 1 from raw_events g
                where g.mint = t.mint
                  and g.event_kind in ('pump_migrate', 'launchlab_migrate', 'dbc_migration_damm_v2')
              ) as graduated
       from (
         select trader as wallet, mint, side, slot,
                null::double precision as sol_amount, null::double precision as token_amount,
                null::bigint as block_time, null::text as funder,
                null::double precision as delayed_mark_usd, null::text as delayed_mark_source,
                null::double precision as exit_mark_usd, signature
         from pump_trade
         where trader is not null and is_creator = false and side in ('buy', 'sell')
         union all
         select wallet, mint, side, slot, sol_amount, token_amount, block_time, funder,
                delayed_mark_usd, delayed_mark_source, exit_mark_usd, signature
         from wallet_early_buy
         where is_creator = false and side in ('buy', 'sell')
       ) t
       left join ingest_coin c on c.mint = t.mint`,
    );
    return result.rows.map((row) => ({
      wallet: row.wallet,
      mint: row.mint,
      side: row.side === "sell" ? "sell" : "buy",
      graduated: row.graduated,
      slot: row.slot === null ? null : Number(row.slot),
      createdSlot: row.created_slot === null ? null : Number(row.created_slot),
      createdAt: row.created_at,
      venue: row.venue,
      solAmount: row.sol_amount === null ? null : Number(row.sol_amount),
      tokenAmount: row.token_amount === null ? null : Number(row.token_amount),
      blockTimeSec: row.block_time === null ? null : Number(row.block_time),
      funder: row.funder,
      delayedMarkUsd: row.delayed_mark_usd === null ? null : Number(row.delayed_mark_usd),
      delayedMarkSource: ((): "jupiter" | "curve_modeled" | "history_swap" | null => {
        const source = row.delayed_mark_source;
        if (source === "history_swap" || source === "jupiter" || source === "curve_modeled") {
          return source;
        }
        return null;
      })(),
      exitMarkUsd: row.exit_mark_usd === null ? null : Number(row.exit_mark_usd),
      signature: row.signature,
      boughtAt: row.block_time === null ? null : new Date(Number(row.block_time) * 1000),
    }));
  }

  async requeueMarkBackfillOnce(): Promise<number> {
    const result = await this.pool.query(
      `update wallet_backfill_mint
       set status = 'open', pagination_token = null, mark_reread = true, updated_at = now()
       where status in ('done', 'skipped') and mark_reread = false`,
    );
    return result.rowCount ?? 0;
  }

  async saveHistoryMarks(
    rows: ReadonlyArray<{
      signature: string;
      wallet: string;
      mint: string;
      delayedMarkUsd: number;
      delayedMarkAt: Date;
      exitMarkUsd: number;
      boughtAt: Date;
    }>,
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `update wallet_early_buy
         set delayed_mark_usd = $4, delayed_mark_at = $5, delayed_mark_source = 'history_swap',
             exit_mark_usd = $6, exit_mark_at = $5, bought_at = $7
         where signature = $1 and wallet = $2 and mint = $3 and delayed_mark_usd is null`,
        [
          row.signature,
          row.wallet,
          row.mint,
          row.delayedMarkUsd,
          row.delayedMarkAt.toISOString(),
          row.exitMarkUsd,
          row.boughtAt.toISOString(),
        ],
      );
    }
  }

  async saveScoreShadow(input: {
    rankedCount: number;
    lookbackStart: string | null;
    lookbackEnd: string | null;
    cutoff: string | null;
    entryCount: number;
    scoringVersion: number;
  }): Promise<void> {
    await this.pool.query(
      `insert into phasec_score_shadow
        (id, ranked_count, lookback_start, lookback_end, cutoff, entry_count, scoring_version, updated_at)
       values (1, $1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set
         ranked_count = excluded.ranked_count,
         lookback_start = excluded.lookback_start,
         lookback_end = excluded.lookback_end,
         cutoff = excluded.cutoff,
         entry_count = excluded.entry_count,
         scoring_version = excluded.scoring_version,
         updated_at = now()`,
      [
        input.rankedCount,
        input.lookbackStart,
        input.lookbackEnd,
        input.cutoff,
        input.entryCount,
        input.scoringVersion,
      ],
    );
  }

  async paperTestClosed(): Promise<boolean> {
    const result = await this.pool.query<{ test_closed: boolean }>(
      "select test_closed from phasec_score_shadow where id = 1",
    );
    return result.rows[0]?.test_closed === true;
  }

  async activeScoringVersion(): Promise<number | null> {
    const result = await this.pool.query<{ version: string | number | null }>(
      "select min(scoring_version) as version from tracked_wallet where active = true",
    );
    const version = result.rows[0]?.version;
    if (version === null || version === undefined) return null;
    const parsed = Number(version);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async paperTestOpen(): Promise<boolean> {
    const result = await this.pool.query("select 1 from phasec_protocol where id = 1");
    return (result.rowCount ?? 0) > 0;
  }

  async activeTrackedWallets(): Promise<string[]> {
    const result = await this.pool.query<{ address: string }>(
      "select address from tracked_wallet where active = true order by hit_rate desc, early_wins desc, address",
    );
    return result.rows.map((row) => row.address);
  }

  async saveTrackedWallets(
    rows: Array<{
      address: string;
      hitRate: number;
      earlyEntries: number;
      earlyWins: number;
      derivation: string;
    }>,
    now: Date,
  ): Promise<void> {
    for (const row of rows) {
      await this.pool.query(
        `insert into tracked_wallet
          (address, hit_rate, early_entries, early_wins, derivation, active, selected_at, scoring_version)
         values ($1,$2,$3,$4,$5,true,$6,$7)
         on conflict (address) do update set
           hit_rate = excluded.hit_rate,
           early_entries = excluded.early_entries,
           early_wins = excluded.early_wins,
           derivation = excluded.derivation,
           active = true,
           selected_at = excluded.selected_at,
           scoring_version = excluded.scoring_version`,
        [
          row.address,
          row.hitRate,
          row.earlyEntries,
          row.earlyWins,
          row.derivation,
          now.toISOString(),
          SCORING_VERSION,
        ],
      );
    }
  }

  async insertWalletFill(input: {
    signature: string;
    eventIndex: number;
    slot: number;
    mint: string;
    wallet: string;
    side: "buy" | "sell" | "swap";
    venue: string;
  }): Promise<void> {
    const inserted = await this.pool.query(
      `insert into wallet_fill
        (signature, event_index, slot, mint, wallet, side, venue)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (signature, event_index, wallet) do nothing`,
      [
        input.signature,
        input.eventIndex,
        input.slot,
        input.mint,
        input.wallet,
        input.side,
        input.venue,
      ],
    );
    if ((inserted.rowCount ?? 0) === 0) return;
    await this.pool.query(
      `insert into coin_wallet_signal
        (mint, tracked_buyers, tracked_buys, tracked_sells, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (mint) do update set
         tracked_buys = coin_wallet_signal.tracked_buys + excluded.tracked_buys,
         tracked_sells = coin_wallet_signal.tracked_sells + excluded.tracked_sells,
         tracked_buyers = (
           select count(distinct wallet) from wallet_fill
           where mint = excluded.mint and side in ('buy', 'swap')
         ),
         updated_at = now()`,
      [
        input.mint,
        input.side === "sell" ? 0 : 1,
        input.side === "buy" ? 1 : 0,
        input.side === "sell" ? 1 : 0,
      ],
    );
  }

  async insertXMentions(
    rows: Array<{
      mint: string | null;
      ticker: string | null;
      handle: string;
      postUrl: string;
      mentionedAt: Date;
      source: string;
    }>,
  ): Promise<number> {
    let stored = 0;
    for (const row of rows) {
      const result = await this.pool.query(
        `insert into coin_x_mention (post_url, mint, ticker, handle, mentioned_at, source)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (post_url) do nothing`,
        [row.postUrl, row.mint, row.ticker, row.handle, row.mentionedAt.toISOString(), row.source],
      );
      stored += result.rowCount ?? 0;
    }
    return stored;
  }

  async featureMonthMicros(feature: string, month: string): Promise<bigint> {
    const result = await this.pool.query<{ micros: string }>(
      `select coalesce(sum(credit_micros), 0)::text as micros
       from ingest_feature_daily
       where feature = $1 and to_char(day, 'YYYY-MM') = $2`,
      [feature, month],
    );
    return BigInt(result.rows[0]?.micros ?? "0");
  }

  async recordFeatureSpend(input: {
    feature: string;
    creditMicros: bigint;
    storedEvents: number;
    now: Date;
  }): Promise<void> {
    if (input.creditMicros <= 0n && input.storedEvents <= 0) return;
    const day = input.now.toISOString().slice(0, 10);
    const month = utcMonth(input.now);
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (input.creditMicros > 0n) {
        await client.query(
          `insert into ingest_daily (day, streamed_bytes, messages, stored_events, credit_micros)
           values ($1, 0, 0, $2, $3)
           on conflict (day) do update set
             stored_events = ingest_daily.stored_events + excluded.stored_events,
             credit_micros = ingest_daily.credit_micros + excluded.credit_micros`,
          [day, input.storedEvents, input.creditMicros.toString()],
        );
        await client.query(
          `insert into ingest_month (month, credit_micros)
           values ($1, $2)
           on conflict (month) do update set
             credit_micros = ingest_month.credit_micros + excluded.credit_micros`,
          [month, input.creditMicros.toString()],
        );
      }
      await client.query(
        `insert into ingest_feature_daily (feature, day, credit_micros, stored_events)
         values ($1, $2, $3, $4)
         on conflict (feature, day) do update set
           credit_micros = ingest_feature_daily.credit_micros + excluded.credit_micros,
           stored_events = ingest_feature_daily.stored_events + excluded.stored_events`,
        [input.feature, day, input.creditMicros.toString(), input.storedEvents],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async nextBackfillMints(limit: number): Promise<
    Array<{
      mint: string;
      venue: string;
      account: string;
      creator: string | null;
      graduated: boolean;
      paginationToken: string | null;
      buysKept: number;
      pages: number;
      failures: number;
    }>
  > {
    const half = Math.max(1, Math.floor(limit / 2));
    const result = await this.pool.query<{
      mint: string;
      venue: string;
      account: string;
      creator: string | null;
      graduated: boolean;
      pagination_token: string | null;
      buys_kept: number;
      pages: number;
      failures: number;
      stage: string;
    }>(
      `with coins as (
         select c.mint,
                c.venue,
                coalesce(p.bonding_curve, c.pool) as account,
                coalesce(p.creator, c.creator) as creator,
                exists (
                  select 1 from raw_events g
                  where g.mint = c.mint
                    and g.event_kind in ('pump_migrate', 'launchlab_migrate', 'dbc_migration_damm_v2')
                ) as graduated
         from ingest_coin c
         left join pump_coin p on p.mint = c.mint
         where coalesce(p.bonding_curve, c.pool) is not null
       ),
       open_rows as (
         select c.mint, c.venue, c.account, c.creator, c.graduated,
                b.pagination_token, b.buys_kept, b.pages, b.failures, 'open' as stage
         from coins c
         join wallet_backfill_mint b on b.mint = c.mint
         where b.status = 'open'
         limit $1
       ),
       fresh_winners as (
         select c.mint, c.venue, c.account, c.creator, c.graduated,
                null::text as pagination_token, 0 as buys_kept, 0 as pages, 0 as failures,
                'fresh' as stage
         from coins c
         where c.graduated
           and not exists (select 1 from wallet_backfill_mint b where b.mint = c.mint)
         order by c.mint
         limit $2
       ),
       fresh_losses as (
         select c.mint, c.venue, c.account, c.creator, c.graduated,
                null::text as pagination_token, 0 as buys_kept, 0 as pages, 0 as failures,
                'fresh' as stage
         from coins c
         where not c.graduated
           and not exists (select 1 from wallet_backfill_mint b where b.mint = c.mint)
         order by c.mint
         limit $2
       )
       select * from open_rows
       union all
       select * from fresh_winners
       union all
       select * from fresh_losses`,
      [limit, half],
    );
    const mapped = result.rows.map((row) => ({
      mint: row.mint,
      venue: row.venue,
      account: row.account,
      creator: row.creator,
      graduated: row.graduated,
      paginationToken: row.pagination_token,
      buysKept: row.buys_kept,
      pages: row.pages,
      failures: row.failures,
      stage: row.stage,
    }));
    return stratifyBackfillMints(
      mapped.filter((row) => row.stage === "open"),
      mapped.filter((row) => row.stage === "fresh"),
      limit,
    );
  }

  async saveEarlyBuyers(
    rows: ReadonlyArray<{
      signature: string;
      eventIndex: number;
      slot: number;
      mint: string;
      wallet: string;
      side: string;
      venue: string;
      isCreator: boolean;
      solAmount?: number | null;
      tokenAmount?: number | null;
      blockTimeSec?: number | null;
      funder?: string | null;
    }>,
  ): Promise<number> {
    let stored = 0;
    for (const row of rows) {
      const result = await this.pool.query(
        `insert into wallet_early_buy
          (signature, event_index, slot, mint, wallet, side, venue, is_creator,
           sol_amount, token_amount, block_time, funder)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (signature, event_index, wallet) do update set
           sol_amount = coalesce(excluded.sol_amount, wallet_early_buy.sol_amount),
           token_amount = coalesce(excluded.token_amount, wallet_early_buy.token_amount),
           block_time = coalesce(excluded.block_time, wallet_early_buy.block_time),
           funder = coalesce(excluded.funder, wallet_early_buy.funder)`,
        [
          row.signature,
          row.eventIndex,
          row.slot,
          row.mint,
          row.wallet,
          row.side,
          row.venue,
          row.isCreator,
          row.solAmount ?? null,
          row.tokenAmount ?? null,
          row.blockTimeSec ?? null,
          row.funder ?? null,
        ],
      );
      await this.pool.query(
        `insert into wallet_fill
          (signature, event_index, slot, mint, wallet, side, venue, sol_amount, token_amount, block_time)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (signature, event_index, wallet) do update set
           sol_amount = coalesce(excluded.sol_amount, wallet_fill.sol_amount),
           token_amount = coalesce(excluded.token_amount, wallet_fill.token_amount),
           block_time = coalesce(excluded.block_time, wallet_fill.block_time)`,
        [
          row.signature,
          row.eventIndex,
          row.slot,
          row.mint,
          row.wallet,
          row.side,
          row.venue,
          row.solAmount ?? null,
          row.tokenAmount ?? null,
          row.blockTimeSec ?? null,
        ],
      );
      stored += result.rowCount ?? 0;
    }
    return stored;
  }

  async saveBackfillCheckpoint(input: {
    mint: string;
    venue: string;
    account: string;
    status: string;
    paginationToken: string | null;
    buysKept: number;
    pages: number;
    creditDelta: number;
    failures?: number;
    lastError?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into wallet_backfill_mint
        (mint, venue, account, status, pagination_token, buys_kept, pages, credits, failures,
         last_error, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       on conflict (mint) do update set
         venue = excluded.venue,
         account = excluded.account,
         status = excluded.status,
         pagination_token = excluded.pagination_token,
         buys_kept = excluded.buys_kept,
         pages = excluded.pages,
         credits = wallet_backfill_mint.credits + excluded.credits,
         failures = excluded.failures,
         last_error = excluded.last_error,
         updated_at = now()`,
      [
        input.mint,
        input.venue,
        input.account,
        input.status,
        input.paginationToken,
        input.buysKept,
        input.pages,
        input.creditDelta,
        input.failures ?? 0,
        input.lastError ?? null,
      ],
    );
  }

  async walletJobFinishedAt(): Promise<Date | null> {
    const result = await this.pool.query<{ finished_at: Date | null }>(
      "select finished_at from wallet_job where id = 1",
    );
    return result.rows[0]?.finished_at ?? null;
  }

  async markWalletJob(now: Date): Promise<void> {
    await this.pool.query(
      `insert into wallet_job (id, finished_at) values (1, $1)
       on conflict (id) do update set finished_at = excluded.finished_at`,
      [now.toISOString()],
    );
  }

  async applyWalletRefresh(
    input: {
      keep: readonly string[];
      upsert: ReadonlyArray<{
        address: string;
        hitRate: number;
        earlyEntries: number;
        earlyWins: number;
        derivation: string;
      }>;
      scoringVersion?: number;
    },
    now: Date,
  ): Promise<void> {
    const version = input.scoringVersion ?? SCORING_VERSION;
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      if (input.keep.length === 0) {
        await client.query(
          "update tracked_wallet set active = false, scoring_version = $1 where active = true",
          [version],
        );
        await client.query("commit");
        return;
      }
      await client.query(
        "update tracked_wallet set active = false, scoring_version = $2 where active = true and address <> all($1::text[])",
        [input.keep, version],
      );
      for (const row of input.upsert) {
        await client.query(
          `insert into tracked_wallet
            (address, hit_rate, early_entries, early_wins, derivation, active, selected_at, scoring_version)
           values ($1,$2,$3,$4,$5,true,$6,$7)
           on conflict (address) do update set
             hit_rate = excluded.hit_rate,
             early_entries = excluded.early_entries,
             early_wins = excluded.early_wins,
             derivation = excluded.derivation,
             active = true,
             selected_at = excluded.selected_at,
             scoring_version = excluded.scoring_version`,
          [
            row.address,
            row.hitRate,
            row.earlyEntries,
            row.earlyWins,
            row.derivation,
            now.toISOString(),
            version,
          ],
        );
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async spotCheckText(limit = 20): Promise<string> {
    return formatSpotCheck(await this.recentEvents(limit));
  }

  async insertRecall(input: {
    ranAt: Date;
    programId: string;
    windowStartSlot: number;
    windowEndSlot: number;
    expected: number;
    matched: number;
    missed: number;
    recovered: number;
    decodeFailed: number;
    credits: number;
    incomplete: boolean;
    errored: boolean;
    errorReason: string | null;
    skipped: boolean;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_recall_audit
        (ran_at, program_id, window_start_slot, window_end_slot, expected, matched, missed,
         recovered, decode_failed, credits, incomplete, errored, error_reason, skipped)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.ranAt.toISOString(),
        input.programId,
        input.windowStartSlot,
        input.windowEndSlot,
        input.expected,
        input.matched,
        input.missed,
        input.recovered,
        input.decodeFailed,
        input.credits,
        input.incomplete,
        input.errored,
        input.errorReason,
        input.skipped,
      ],
    );
  }

  async recallTotals(
    since: Date,
    scope?: { programIds: readonly string[]; coverageSlot: number | null },
  ): Promise<{ missed: number; expected: number; windows: number }> {
    const result = await this.pool.query<{
      missed: string;
      expected: string;
      windows: string;
    }>(
      `select coalesce(sum(missed), 0)::text as missed,
              coalesce(sum(expected), 0)::text as expected,
              count(*)::text as windows
       from ingest_recall_audit
       where ran_at >= $1
         and incomplete = false
         and errored = false
         and skipped = false
         and ($2::text[] is null or program_id = any($2::text[]))
         and ($3::bigint is null or window_start_slot >= $3)`,
      [since.toISOString(), scope ? [...scope.programIds] : null, scope?.coverageSlot ?? null],
    );
    const row = result.rows[0];
    return {
      missed: Number(row?.missed ?? 0),
      expected: Number(row?.expected ?? 0),
      windows: Number(row?.windows ?? 0),
    };
  }

  async chainCheckpoint(chain: string): Promise<{
    blockNumber: number;
    coverageBlock: number | null;
    reconnects: number;
  } | null> {
    const result = await this.pool.query<{
      block_number: string;
      coverage_block: string | null;
      reconnects: string | null;
    }>(
      "select block_number, coverage_block, reconnects from ingest_chain_checkpoint where chain = $1",
      [chain],
    );
    const row = result.rows[0];
    if (!row) return null;
    const coverage = row.coverage_block == null ? null : Number(row.coverage_block);
    return {
      blockNumber: Number(row.block_number),
      coverageBlock: coverage !== null && Number.isFinite(coverage) ? coverage : null,
      reconnects: Number(row.reconnects ?? 0),
    };
  }

  async noteChainReconnect(chain: string): Promise<number> {
    const result = await this.pool.query<{ reconnects: string }>(
      `update ingest_chain_checkpoint
       set reconnects = reconnects + 1, updated_at = now()
       where chain = $1
       returning reconnects`,
      [chain],
    );
    return Number(result.rows[0]?.reconnects ?? 0);
  }

  async saveChainCheckpoint(input: {
    chain: string;
    blockNumber: number;
    coverageBlock: number | null;
    now: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_chain_checkpoint (chain, block_number, coverage_block, updated_at)
       values ($1,$2,$3,$4)
       on conflict (chain) do update set
         block_number = greatest(ingest_chain_checkpoint.block_number, excluded.block_number),
         coverage_block = coalesce(ingest_chain_checkpoint.coverage_block, excluded.coverage_block),
         updated_at = excluded.updated_at`,
      [input.chain, input.blockNumber, input.coverageBlock, input.now.toISOString()],
    );
  }

  async rememberAsset(input: {
    chain: string;
    address: string;
    launchpad: string;
    quoteAddress: string | null;
    taxBps: number | null;
    buyTaxBps: number | null;
    sellTaxBps: number | null;
    pool: string | null;
    clPoolId: string | null;
    creator: string | null;
    createdBlock: number | null;
    createdAt: Date;
    txHash: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_asset
        (chain, address, launchpad, quote_address, tax_bps, buy_tax_bps, sell_tax_bps, pool,
         cl_pool_id, creator, created_block, created_at, tx_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       on conflict (chain, address) do update set
         quote_address = coalesce(ingest_asset.quote_address, excluded.quote_address),
         tax_bps = coalesce(ingest_asset.tax_bps, excluded.tax_bps),
         buy_tax_bps = coalesce(ingest_asset.buy_tax_bps, excluded.buy_tax_bps),
         sell_tax_bps = coalesce(ingest_asset.sell_tax_bps, excluded.sell_tax_bps),
         pool = coalesce(excluded.pool, ingest_asset.pool),
         cl_pool_id = coalesce(ingest_asset.cl_pool_id, excluded.cl_pool_id),
         creator = coalesce(ingest_asset.creator, excluded.creator),
         created_block = coalesce(ingest_asset.created_block, excluded.created_block)`,
      [
        input.chain,
        input.address,
        input.launchpad,
        input.quoteAddress,
        input.taxBps,
        input.buyTaxBps,
        input.sellTaxBps,
        input.pool,
        input.clPoolId,
        input.creator,
        input.createdBlock,
        input.createdAt.toISOString(),
        input.txHash,
      ],
    );
  }

  async insertChainEvent(input: {
    chain: string;
    txHash: string;
    logIndex: number;
    blockNumber: number;
    eventName: string;
    address: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `insert into ingest_chain_event
        (chain, tx_hash, log_index, block_number, event_name, address)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (chain, tx_hash, log_index) do nothing`,
      [
        input.chain,
        input.txHash,
        input.logIndex,
        input.blockNumber,
        input.eventName,
        input.address,
      ],
    );
    return result.rowCount === 1;
  }

  async chainEventKeys(chain: string, fromBlock: number, toBlock: number): Promise<Set<string>> {
    const result = await this.pool.query<{ tx_hash: string; log_index: number }>(
      `select tx_hash, log_index from ingest_chain_event
       where chain = $1 and block_number >= $2 and block_number <= $3`,
      [chain, fromBlock, toBlock],
    );
    return new Set(result.rows.map((row) => `${row.tx_hash}:${row.log_index.toString()}`));
  }

  async scheduleAssetEnrich(input: {
    chain: string;
    address: string;
    attempt: number;
    dueAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_asset_enrich (chain, address, attempt, due_at)
       values ($1,$2,$3,$4)
       on conflict (chain, address) do update set
         attempt = excluded.attempt,
         due_at = excluded.due_at`,
      [input.chain, input.address, input.attempt, input.dueAt.toISOString()],
    );
  }

  async dueAssetEnrich(
    now: Date,
    limit = 20,
  ): Promise<Array<{ chain: string; address: string; attempt: number }>> {
    const result = await this.pool.query<{ chain: string; address: string; attempt: number }>(
      `select chain, address, attempt from ingest_asset_enrich
       where due_at <= $1
       order by due_at
       limit $2`,
      [now.toISOString(), limit],
    );
    return result.rows;
  }

  async clearAssetEnrich(chain: string, address: string): Promise<void> {
    await this.pool.query("delete from ingest_asset_enrich where chain = $1 and address = $2", [
      chain,
      address,
    ]);
  }

  async latestChainAudit(chain: string): Promise<{
    expected: number;
    matched: number;
    missed: number;
  } | null> {
    const result = await this.pool.query<{ expected: number; matched: number; missed: number }>(
      `select expected, matched, missed from ingest_chain_audit
       where chain = $1
       order by ran_at desc
       limit 1`,
      [chain],
    );
    return result.rows[0] ?? null;
  }

  async insertChainAudit(input: {
    chain: string;
    ranAt: Date;
    fromBlock: number;
    toBlock: number;
    expected: number;
    matched: number;
    missed: number;
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_chain_audit
        (chain, ran_at, from_block, to_block, expected, matched, missed)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.chain,
        input.ranAt.toISOString(),
        input.fromBlock,
        input.toBlock,
        input.expected,
        input.matched,
        input.missed,
      ],
    );
  }

  /** Graduations whose mint has no create row, inside the live venue and coverage. */
  async creationUnseen(
    venue: IngestVenue = "pump",
    coverageSlot: number | null = null,
  ): Promise<number> {
    const laterKinds =
      venue === "pump"
        ? ["pump_migrate"]
        : venue === "launchlab"
          ? ["launchlab_migrate"]
          : ["dbc_migration_damm_v2", "dbc_curve_complete"];
    const createKinds =
      venue === "pump"
        ? ["pump_create", "pump_create_v2"]
        : venue === "launchlab"
          ? ["launchlab_initialize"]
          : ["dbc_initialize"];
    const result = await this.pool.query<{ unseen: string }>(
      `select count(*)::text as unseen
       from raw_events later
       where later.event_kind = any($1::text[])
         and later.mint is not null
         and ($3::bigint is null or later.slot >= $3)
         and not exists (
           select 1 from raw_events init
           where init.mint = later.mint and init.event_kind = any($2::text[])
         )`,
      [laterKinds, createKinds, coverageSlot],
    );
    return Number(result.rows[0]?.unseen ?? 0);
  }

  async rememberPumpCoin(input: {
    mint: string;
    bondingCurve: string;
    creator: string | null;
    createdSlot: number;
    createdAt: Date;
    signature: string;
  }): Promise<void> {
    await this.pool.query(
      `insert into pump_coin (mint, bonding_curve, creator, created_slot, created_at, signature)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (mint) do nothing`,
      [
        input.mint,
        input.bondingCurve,
        input.creator,
        input.createdSlot,
        input.createdAt.toISOString(),
        input.signature,
      ],
    );
  }

  async pumpCoin(mint: string): Promise<{ createdSlot: number; creator: string | null } | null> {
    const result = await this.pool.query<{ created_slot: string; creator: string | null }>(
      "select created_slot, creator from pump_coin where mint = $1",
      [mint],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { createdSlot: Number(row.created_slot), creator: row.creator };
  }

  async insertPumpTrade(input: {
    signature: string;
    eventIndex: number;
    slot: number;
    mint: string;
    side: "buy" | "sell";
    trader: string | null;
    isCreator: boolean;
    reason: string;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `insert into pump_trade
        (signature, event_index, slot, mint, side, trader, is_creator, reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (signature, event_index) do nothing`,
      [
        input.signature,
        input.eventIndex,
        input.slot,
        input.mint,
        input.side,
        input.trader,
        input.isCreator,
        input.reason,
      ],
    );
    return result.rowCount === 1;
  }

  async bumpPumpStats(input: {
    mint: string;
    slot: number;
    side: "buy" | "sell";
    creatorSell: boolean;
    at: Date;
  }): Promise<void> {
    await this.pool.query(
      `insert into pump_coin_stats (mint, buys, sells, creator_sells, last_slot, updated_at)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (mint) do update set
         buys = pump_coin_stats.buys + excluded.buys,
         sells = pump_coin_stats.sells + excluded.sells,
         creator_sells = pump_coin_stats.creator_sells + excluded.creator_sells,
         last_slot = greatest(pump_coin_stats.last_slot, excluded.last_slot),
         updated_at = excluded.updated_at`,
      [
        input.mint,
        input.side === "buy" ? 1 : 0,
        input.side === "sell" ? 1 : 0,
        input.creatorSell ? 1 : 0,
        input.slot,
        input.at.toISOString(),
      ],
    );
  }

  async alertableCandidates(limit: number): Promise<
    Array<{
      mint: string;
      pool: string;
      source: string;
      firstSeenAt: Date;
    }>
  > {
    const result = await this.pool.query<{
      mint: string;
      pool: string;
      source: string;
      first_seen_at: Date;
    }>(
      `select mint, pool, source, first_seen_at
       from candidates
       where source <> 'audit'
       order by first_seen_at desc
       limit $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      mint: row.mint,
      pool: row.pool,
      source: row.source,
      firstSeenAt: new Date(row.first_seen_at),
    }));
  }
}

function eventPayload(observation: Observation): Record<string, unknown> {
  return {
    kind: observation.kind,
    poolType: observation.poolType,
    mint: observation.mint,
    pool: observation.pool,
    creatorWallet: observation.creatorWallet,
    virtualPool: observation.virtualPool,
    quoteMint: observation.quoteMint,
    instructionName: observation.instructionName ?? null,
    launchpad: observation.launchpad ?? null,
    platformConfig: observation.platformConfig ?? null,
    transferFeeBps: observation.transferFeeBps ?? null,
  };
}
