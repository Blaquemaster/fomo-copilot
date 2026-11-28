import type pg from "pg";

import { IngestRepository } from "../db/ingest.js";
import { ExecutionBook, createTestSigner } from "../execution/book.js";
import { EXECUTION_ASSUMPTIONS, evaluationRunner } from "../evaluation/primary.js";
import { PUMP_PROGRAM_ID } from "../ingest/programs.js";
import { admitOne } from "../phasec/admission.js";
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
  const size = sizedFromRoute({
    route: input.buy === "available" && input.sell === "available" ? "available" : "unavailable",
    amount: input.amount,
  });
  const admission =
    size.state === "ready"
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
    await client.query(
      `insert into autobuy_intent (kind, mint, arm, stage, size_usd, quote_price, reason, simulated, created_at)
       values ('buy',$1,'primary','post_graduation',$2,null,$3,'simulated',$4)`,
      [input.mint, input.amount, order?.reason ?? "not_admitted", input.now],
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
