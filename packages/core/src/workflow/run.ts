import type pg from "pg";

import { IngestRepository } from "../db/ingest.js";
import { ExecutionBook, createTestSigner } from "../execution/book.js";
import { EXECUTION_ASSUMPTIONS, evaluationRunner } from "../evaluation/primary.js";
import { PUMP_PROGRAM_ID } from "../ingest/programs.js";
import { executionEconomics } from "../execution/economics.js";
import { placeSwap } from "../execution/swapClient.js";
import { admitOne } from "../phasec/admission.js";
import { applyEntryPolicy, positionWriteAllowed } from "../phasec/policy.js";
import { sizedFromRoute } from "../records/readiness.js";

export interface WorkflowResult {
  runId: string;
  mint: string;
  eventId: string;
  decision: "ready" | "unavailable";
  executionState: string;
  evaluationScored: boolean;
}

/**
 * One simulated path from a stored event to a held execution and an evaluation row.
 * It does not submit an order and does not load a production key.
 */
export async function runSimulatedWorkflow(
  pool: pg.Pool,
  input: {
    runId: string;
    mint: string;
    signature: string;
    wallet: string;
    amount: number;
    now: Date;
    releaseSha: string;
    buy: "available" | "unavailable";
    sell: "available" | "unavailable";
    jupiterNet: number | null;
  },
): Promise<WorkflowResult> {
  const repo = new IngestRepository(pool);
  const inserted = await repo.insertRaw(
    {
      signature: input.signature,
      slot: 1,
      programId: PUMP_PROGRAM_ID,
      eventIndex: 0,
      kind: "pump_create",
      poolType: "pump",
      mint: input.mint,
      pool: null,
      creatorWallet: input.wallet,
      virtualPool: null,
      quoteMint: null,
      blockTimeMs: input.now.getTime(),
    },
    32,
    input.now,
    "backfill",
  );
  const eventId = inserted ? `${input.signature}:0` : `${input.signature}:0`;
  const route =
    input.buy === "available" && input.sell === "available" ? "available" : "unavailable";
  const policy = applyEntryPolicy({
    amount: input.amount,
    bankroll: 20,
    exitReserve: 5,
    route,
    liquidityUsd: route === "available" ? 1000 : null,
    fresh: true,
  });
  const allowed = positionWriteAllowed(policy);
  const size = sizedFromRoute({ route, amount: input.amount });
  const placed = placeSwap({ mint: input.mint, amount: input.amount });
  const economics = executionEconomics({ estimatedFee: null });
  const admission =
    allowed.written && size.state === "ready"
      ? admitOne({
          signals: [
            { mint: input.mint, stage: "post_graduation", owner: "primary", amount: input.amount },
            { mint: input.mint, stage: "second_wave", owner: "second", amount: input.amount },
          ],
          bankroll: 20,
          exitReserve: 5,
        })
      : null;
  const book = new ExecutionBook(
    { entriesPaused: false, exitsOnly: false, signingPaused: false },
    createTestSigner(),
    20,
    5,
  );
  const order =
    admission?.admitted === null || admission === null
      ? null
      : book.signal({
          mint: input.mint,
          stage: "post_graduation",
          side: "buy",
          owner: "primary",
          amount: input.amount,
          coverage: { stage: "post_graduation", buy: input.buy, sell: input.sell },
          instructions: [
            {
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              destination: input.mint,
              amount: input.amount,
              referencedAccounts: [input.mint],
            },
          ],
          allowedAccounts: [input.mint],
          at: input.now.getTime(),
        });
  const evaluation = evaluationRunner({
    assumptionsVersion: EXECUTION_ASSUMPTIONS.version,
    rows: [{ enrolled: true, filled: false, outcome: input.jupiterNet }],
    coverage: [{ stage: "post_graduation", buy: input.buy, sell: input.sell }],
  });
  const decision = size.state === "ready" ? "ready" : "unavailable";
  const executionState = order?.state ?? "not_admitted";
  const client = await pool.connect();
  try {
    await client.query("begin");
    const steps: { step: string; state: string; detail: string }[] = [
      { step: "ingest", state: "ready", detail: eventId },
      { step: "wallet", state: "ready", detail: input.wallet },
      { step: "decision", state: decision, detail: size.state },
      {
        step: "admission",
        state: admission?.admitted ? "ready" : "unavailable",
        detail: admission?.rejected[0]?.reason ?? "none",
      },
      { step: "execution", state: executionState, detail: order?.reason ?? "held" },
      {
        step: "quote",
        state: "estimated",
        detail: economics.quote.estimatedFee === null ? "unknown" : "estimated",
      },
      { step: "simulation", state: economics.simulation.state, detail: placed.reason },
      { step: "fill", state: "absent", detail: "no_fill" },
      { step: "reconciliation", state: "held", detail: "submission_boundary_held" },
      { step: "ledger", state: order ? "authorized" : "unavailable", detail: input.runId },
      {
        step: "evaluation",
        state: evaluation.scored ? "ready" : "unavailable",
        detail: evaluation.scored ? evaluation.assumptions.version : "assumptions_version_mismatch",
      },
    ];
    for (const step of steps) {
      await client.query(
        `insert into workflow_step (run_id, step, mint, state, detail, recorded_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (run_id, step) do update
         set state = excluded.state, detail = excluded.detail, recorded_at = excluded.recorded_at`,
        [input.runId, step.step, input.mint, step.state, step.detail, input.now],
      );
    }
    if (admission?.admitted) {
      await client.query(
        `insert into owner_position (mint, reserved, observed_at)
         values ($1,$2,$3)
         on conflict (mint) do update set reserved = excluded.reserved, observed_at = excluded.observed_at`,
        [input.mint, admission.admitted.reserved, input.now],
      );
    }
    await client.query(
      `insert into owner_service (name, mode, observed_at) values ('dashboard','dry_run',$1)
       on conflict (name) do update set mode = excluded.mode, observed_at = excluded.observed_at`,
      [input.now],
    );
    await client.query(
      `insert into completion_decision (id, mint, event_ids, list_version, execution_id, readiness, recorded_at)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id) do update set readiness = excluded.readiness, recorded_at = excluded.recorded_at`,
      [input.runId, input.mint, eventId, "unset", order?.id ?? null, decision, input.now],
    );
    await client.query(`update completion_decision set policy_version = $2 where id = $1`, [
      input.runId,
      policy.version,
    ]);
    await client.query(
      `insert into cash_entry (run_id, kind, amount, note, recorded_at)
       select $1, 'fee', 0, 'fee unknown until a real acknowledgement', $2
       where not exists (select 1 from cash_entry where run_id = $1 and kind = 'fee')`,
      [input.runId, input.now],
    );
    const intentReason = `${input.runId}:${order?.reason ?? "not_admitted"}`;
    await client.query(
      `insert into autobuy_intent (kind, mint, arm, stage, size_usd, quote_price, reason, simulated, created_at)
       select 'buy',$1,'primary','post_graduation',$2,null,$3,'simulated',$4
       where not exists (select 1 from autobuy_intent where reason = $3)`,
      [input.mint, input.amount, intentReason, input.now],
    );
    await client.query(
      `insert into cash_entry (run_id, kind, amount, note, recorded_at)
       select $1, 'attempt', 0, 'submission held; no network fee', $2
       where not exists (select 1 from cash_entry where run_id = $1 and kind = 'attempt')`,
      [input.runId, input.now],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  return {
    runId: input.runId,
    mint: input.mint,
    eventId,
    decision,
    executionState,
    evaluationScored: evaluation.scored,
  };
}

export async function recordCashCorrection(
  pool: pg.Pool,
  input: { runId: string; amount: number; note: string; at: Date },
): Promise<void> {
  await pool.query(
    `insert into cash_entry (run_id, kind, amount, note, recorded_at) values ($1,'correction',$2,$3,$4)`,
    [input.runId, input.amount, input.note, input.at],
  );
}

export async function readDecisionRecord(
  pool: pg.Pool,
  runId: string,
): Promise<{
  eventId: string | null;
  policyVersion: string | null;
  intents: number;
  attempts: number;
  corrections: number;
  fill: string | null;
}> {
  const decision = await pool.query<{ event_ids: string; policy_version: string | null }>(
    "select event_ids, policy_version from completion_decision where id = $1",
    [runId],
  );
  const intents = await pool.query<{ count: string }>(
    "select count(*)::text as count from autobuy_intent where reason like $1",
    [`${runId}:%`],
  );
  const cash = await pool.query<{ kind: string; count: string }>(
    "select kind, count(*)::text as count from cash_entry where run_id = $1 group by kind",
    [runId],
  );
  const fill = await pool.query<{ state: string }>(
    "select state from workflow_step where run_id = $1 and step = 'fill'",
    [runId],
  );
  const countFor = (kind: string) =>
    Number(cash.rows.find((row) => row.kind === kind)?.count ?? "0");
  return {
    eventId: decision.rows[0]?.event_ids ?? null,
    policyVersion: decision.rows[0]?.policy_version ?? null,
    intents: Number(intents.rows[0]?.count ?? "0"),
    attempts: countFor("attempt"),
    corrections: countFor("correction"),
    fill: fill.rows[0]?.state ?? null,
  };
}
