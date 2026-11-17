import { pathToFileURL } from "node:url";

import {
  BACKFILL_MAX_SLOT_SPAN,
  IngestRepository,
  programsForVenue,
  allowanceCredits,
  budgetLevel,
  createPool,
  decodeRpcTransaction,
  migrate,
  scanNamesForProgram,
  auditMaxPages,
  auditSpanSlots,
  planAuditWindow,
  coverAuditWindow,
  recallShouldAlert,
  sendTelegramMessage,
  startApp,
  diffSignatures,
  type Env,
  type Logger,
} from "@fomo/core";

import { getSlot, getTransaction, scanInstructionHistory } from "./helius.js";

export function auditScanErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("HTTP 400")) return "scan_rejected";
  return "scan_failed";
}

/**
 * One 15-minute window per watched program. Meant to be `docker compose run --rm`,
 * not a task inside the live ingestor.
 */
export async function runRecallAudit(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  now?: () => number;
  tipSlot?: number;
  scan?: typeof scanInstructionHistory;
  fetchTransaction?: (signature: string) => Promise<unknown>;
}): Promise<void> {
  const now = input.now ?? Date.now;
  const month = await input.repo.monthUsage(new Date(now()));
  const allowance = allowanceCredits(input.env.HELIUS_PLAN, input.env.HELIUS_MONTHLY_CREDITS);
  if (budgetLevel(month.creditMicros, allowance) === "pause") {
    input.logger.warn({}, "skipping recall audit because non-essential Helius calls are paused");
    return;
  }
  const tip =
    input.tipSlot ??
    (await getSlot(input.env.HELIUS_API_KEY, (method) => {
      void input.repo.addUsage({
        now: new Date(),
        streamedBytes: 0n,
        messages: 0,
        storedEvents: 0,
        creditMicros: 1_000_000n,
      });
      void method;
    }));
  if (tip === null) {
    input.logger.warn({}, "recall audit skipped; getSlot returned no tip");
    return;
  }
  const scan = input.scan ?? scanInstructionHistory;
  const fetchTransaction =
    input.fetchTransaction ??
    ((signature: string) => getTransaction(input.env.HELIUS_API_KEY, signature));
  const coverage = await input.repo.ingestCursor();
  let windowMissed = 0;
  const scanErrors: Array<{ programId: string; reason: string }> = [];
  const programs = programsForVenue(input.env.INGEST_VENUE).filter(
    (programId) => scanNamesForProgram(programId, input.env.PUMP_SUBSCRIBE_CREATE_POOL).length > 0,
  );
  for (const programId of programs) {
    const planned = planAuditWindow({
      nowMs: now(),
      tipSlot: tip,
      programId,
      spanSlots: auditSpanSlots(programId),
    });
    const covered = coverAuditWindow({ window: planned, coverageSlot: coverage.coverageSlot });
    if (covered.action === "skip") {
      input.logger.info(
        { programId, window: planned, coverageSlot: coverage.coverageSlot },
        "recall window is before stream coverage",
      );
      try {
        await input.repo.insertRecall({
          ranAt: new Date(now()),
          programId,
          windowStartSlot: planned.fromSlot,
          windowEndSlot: planned.toSlot,
          expected: 0,
          matched: 0,
          missed: 0,
          recovered: 0,
          decodeFailed: 0,
          credits: 0,
          incomplete: false,
          errored: false,
          errorReason: "before_coverage",
          skipped: true,
        });
      } catch (writeError) {
        input.logger.error(
          { err: writeError, programId },
          "failed to record skipped recall window",
        );
      }
      continue;
    }
    const window = { fromSlot: covered.fromSlot, toSlot: covered.toSlot };
    if (window.toSlot - window.fromSlot > BACKFILL_MAX_SLOT_SPAN * 20) {
      input.logger.warn({ programId, window }, "recall window is unexpectedly wide");
    }
    let scanned: Awaited<ReturnType<typeof scan>>;
    try {
      scanned = await scan({
        apiKey: input.env.HELIUS_API_KEY,
        programId,
        instructionNames: scanNamesForProgram(programId, input.env.PUMP_SUBSCRIBE_CREATE_POOL),
        slotGt: window.fromSlot - 1,
        slotLte: window.toSlot,
        maxPages: auditMaxPages(programId),
      });
    } catch (error) {
      const reason = auditScanErrorReason(error);
      scanErrors.push({ programId, reason });
      input.logger.error({ err: error, programId, reason }, "recall scan failed");
      try {
        await input.repo.insertRecall({
          ranAt: new Date(now()),
          programId,
          windowStartSlot: window.fromSlot,
          windowEndSlot: window.toSlot,
          expected: 0,
          matched: 0,
          missed: 0,
          recovered: 0,
          decodeFailed: 0,
          credits: 0,
          incomplete: false,
          errored: true,
          errorReason: reason,
          skipped: false,
        });
      } catch (writeError) {
        input.logger.error({ err: writeError, programId }, "failed to record recall scan error");
      }
      continue;
    }
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: BigInt(scanned.creditsCharged) * 1_000_000n,
    });
    if (!scanned.complete) {
      await input.repo.insertRecall({
        ranAt: new Date(now()),
        programId,
        windowStartSlot: window.fromSlot,
        windowEndSlot: window.toSlot,
        expected: scanned.matches.length,
        matched: 0,
        missed: 0,
        recovered: 0,
        decodeFailed: 0,
        credits: scanned.creditsCharged,
        incomplete: true,
        errored: false,
        errorReason: null,
        skipped: false,
      });
      input.logger.warn(
        { programId, credits: scanned.creditsCharged },
        "recall scan did not finish the window",
      );
      continue;
    }
    const known = await input.repo.knownSignatures(scanned.matches.map((match) => match.signature));
    const diff = diffSignatures(
      scanned.matches.map((match) => match.signature),
      known,
    );
    let recovered = 0;
    let decodeFailed = 0;
    for (const signature of diff.missed) {
      try {
        const result = await fetchTransaction(signature);
        await input.repo.addUsage({
          now: new Date(),
          streamedBytes: 0n,
          messages: 0,
          storedEvents: 0,
          creditMicros: 1_000_000n,
        });
        if (result == null) {
          decodeFailed += 1;
          continue;
        }
        const decoded = decodeRpcTransaction(result, signature);
        if (decoded.observations.length === 0) {
          decodeFailed += 1;
          continue;
        }
        for (const observation of decoded.observations) {
          const receivedAt =
            observation.blockTimeMs === null ? new Date(now()) : new Date(observation.blockTimeMs);
          const inserted = await input.repo.persistEvent({
            observation,
            byteLength: 0,
            receivedAt,
            source: "audit",
          });
          if (inserted) recovered += 1;
        }
      } catch (error) {
        decodeFailed += 1;
        input.logger.warn({ err: error, signature }, "recall audit could not store a miss");
      }
    }
    windowMissed += diff.missed.length;
    await input.repo.insertRecall({
      ranAt: new Date(now()),
      programId,
      windowStartSlot: window.fromSlot,
      windowEndSlot: window.toSlot,
      expected: diff.matched.length + diff.missed.length,
      matched: diff.matched.length,
      missed: diff.missed.length,
      recovered,
      decodeFailed,
      credits: scanned.creditsCharged + diff.missed.length,
      incomplete: false,
      errored: false,
      errorReason: null,
      skipped: false,
    });
    input.logger.info(
      {
        programId,
        fromSlot: window.fromSlot,
        toSlot: window.toSlot,
        expected: diff.matched.length + diff.missed.length,
        missed: diff.missed.length,
        recovered,
      },
      "recall audit window",
    );
  }
  const since = new Date(now() - 7 * 24 * 60 * 60 * 1000);
  const week = await input.repo.recallTotals(since);
  const alert = recallShouldAlert({
    windowMissed,
    sevenDayMissed: week.missed,
    sevenDayExpected: week.expected,
  });
  const unseen = await input.repo.creationUnseen();
  input.logger.info(
    { unseen, windows: week.windows, missed: week.missed, expected: week.expected },
    "creation unseen",
  );
  if (scanErrors.length > 0 || alert.window || alert.week) {
    const loss =
      week.expected === 0 ? "n/a" : `${((week.missed / week.expected) * 100).toFixed(2)}%`;
    const failed = scanErrors.map((row) => `${row.programId} ${row.reason}`).join(", ");
    await sendTelegramMessage({
      token: input.env.TELEGRAM_BOT_TOKEN,
      chatId: input.env.TELEGRAM_ADMIN_CHAT_ID,
      text: [
        "FOMO copilot recall audit",
        `scan errors: ${scanErrors.length === 0 ? "none" : failed}`,
        `misses this run: ${windowMissed.toString()}`,
        `7 day loss: ${loss} (${week.missed.toString()}/${week.expected.toString()})`,
        `creation unseen: ${unseen.toString()}`,
      ].join("\n"),
    });
  }
}

const isDirect =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  await startApp({
    app: "ingestor",
    run: async ({ env, logger }) => {
      const pool = createPool(env.DATABASE_URL, { synchronousCommitOff: true });
      const repo = new IngestRepository(pool);
      try {
        await migrate(pool);
        await runRecallAudit({ env, repo, logger });
      } finally {
        await pool.end();
      }
    },
  });
}
