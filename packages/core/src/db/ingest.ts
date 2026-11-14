import pg from "pg";

import {
  allowanceCredits,
  formatCredits,
  projectMonthlyCredits,
  utcMonth,
  type HeliusPlan,
} from "../ingest/budget.js";
import type { DecodeFailure, Observation } from "../ingest/decode.js";
import {
  monthUsedPercent,
  formatIngestStatus,
  formatSpotCheck,
  type SpotCheckRow,
} from "../ingest/statusText.js";
import type { CandidateDraft, CurveMark, GraduationMark } from "../ingest/apply.js";

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
`;

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    statement_timeout: 10_000,
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
  ): Promise<boolean> {
    const result = await this.pool.query(
      `insert into raw_events
        (signature, event_index, slot, program_id, event_kind, mint, pool, payload, byte_length, received_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
       on conflict (signature, event_index) do nothing`,
      [
        observation.signature,
        observation.eventIndex,
        observation.slot,
        observation.programId,
        observation.kind,
        observation.mint,
        observation.pool,
        JSON.stringify({
          kind: observation.kind,
          poolType: observation.poolType,
          mint: observation.mint,
          pool: observation.pool,
          creatorWallet: observation.creatorWallet,
          virtualPool: observation.virtualPool,
          quoteMint: observation.quoteMint,
        }),
        byteLength,
        receivedAt.toISOString(),
      ],
    );
    return result.rowCount === 1;
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
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_backfill
        (observed_at, program_id, gap_seconds, gap_slots, events_recovered, pages_fetched,
         signatures_seen, transactions_fetched, reached_checkpoint, credit_cap_hit,
         unrecovered, gap_from_slot, gap_to_slot)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
      ],
    );
  }

  async lastLiveSlot(): Promise<number | null> {
    const result = await this.pool.query<{ last_slot: string | null }>(
      "select last_slot from ingest_status where id = 1",
    );
    const value = result.rows[0]?.last_slot;
    if (value == null) return null;
    const slot = Number(value);
    return Number.isFinite(slot) ? slot : null;
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

  async statusReport(input: {
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
    const allowance = allowanceCredits(input.plan, input.allowanceOverride);
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

  async spotCheckText(limit = 20): Promise<string> {
    return formatSpotCheck(await this.recentEvents(limit));
  }
}
