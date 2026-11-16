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
  projectMonthlyCredits,
  utcMonth,
  type HeliusPlan,
} from "../ingest/budget.js";
import type { DecodeFailure, Observation } from "../ingest/decode.js";
import type { FrameHourRow } from "../ingest/frameStats.js";
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

create index if not exists ingest_recall_audit_ran_idx on ingest_recall_audit (ran_at desc);
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

  async flushAccounting(input: {
    now: Date;
    streamedBytes: bigint;
    messages: number;
    storedEvents: number;
    creditMicros: bigint;
    frames: readonly FrameHourRow[];
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

  async statusReport(input: {
    plan: HeliusPlan;
    allowanceOverride: number | undefined;
    now: Date;
  }): Promise<string> {
    const base = await this.statusBody(input);
    const since = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const week = await this.recallTotals(since);
    const unseen = await this.creationUnseen();
    const loss =
      week.expected === 0 ? "n/a" : `${((week.missed / week.expected) * 100).toFixed(2)}%`;
    return [
      base,
      `recall loss 7d: ${loss} (${week.missed.toString()}/${week.expected.toString()})`,
      `creation unseen: ${unseen.toString()}`,
    ].join("\n");
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
  }): Promise<void> {
    await this.pool.query(
      `insert into ingest_recall_audit
        (ran_at, program_id, window_start_slot, window_end_slot, expected, matched, missed,
         recovered, decode_failed, credits, incomplete, errored, error_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
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
      ],
    );
  }

  async recallTotals(since: Date): Promise<{ missed: number; expected: number; windows: number }> {
    const result = await this.pool.query<{
      missed: string;
      expected: string;
      windows: string;
    }>(
      `select coalesce(sum(missed), 0)::text as missed,
              coalesce(sum(expected), 0)::text as expected,
              count(*)::text as windows
       from ingest_recall_audit
       where ran_at >= $1 and incomplete = false and errored = false`,
      [since.toISOString()],
    );
    const row = result.rows[0];
    return {
      missed: Number(row?.missed ?? 0),
      expected: Number(row?.expected ?? 0),
      windows: Number(row?.windows ?? 0),
    };
  }

  /** Migrations and curve completions whose mint has no initialize row. */
  async creationUnseen(): Promise<number> {
    const result = await this.pool.query<{ unseen: string }>(
      `select count(*)::text as unseen
       from raw_events later
       where later.event_kind in ('dbc_migration_damm_v2', 'dbc_curve_complete')
         and later.mint is not null
         and not exists (
           select 1 from raw_events init
           where init.mint = later.mint and init.event_kind = 'dbc_initialize'
         )`,
    );
    return Number(result.rows[0]?.unseen ?? 0);
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
  };
}
