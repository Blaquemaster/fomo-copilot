import { pathToFileURL } from "node:url";

import {
  BACKFILL_MAX_SLOT_SPAN,
  IngestRepository,
  WATCHED_PROGRAMS,
  allowanceCredits,
  budgetLevel,
  createPool,
  decodeRpcTransaction,
  migrate,
  parsedNamesForProgram,
  planAuditWindow,
  recallShouldAlert,
  sendTelegramMessage,
  startApp,
  diffSignatures,
  type Env,
  type Logger,
} from "@fomo/core";

import { getSlot, getTransaction, scanInstructionHistory } from "./helius.js";

const AUDIT_PAGES = 8;

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
  let windowMissed = 0;
  for (const programId of WATCHED_PROGRAMS) {
    const window = planAuditWindow({ nowMs: now(), tipSlot: tip, programId });
    if (window.toSlot - window.fromSlot > BACKFILL_MAX_SLOT_SPAN * 20) {
      input.logger.warn({ programId, window }, "recall window is unexpectedly wide");
    }
    const scanned = await scan({
      apiKey: input.env.HELIUS_API_KEY,
      programId,
      instructionNames: parsedNamesForProgram(programId),
      slotGt: window.fromSlot - 1,
      slotLte: window.toSlot,
      maxPages: AUDIT_PAGES,
    });
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
  if (alert.window || alert.week) {
    const loss =
      week.expected === 0 ? "n/a" : `${((week.missed / week.expected) * 100).toFixed(2)}%`;
    await sendTelegramMessage({
      token: input.env.TELEGRAM_BOT_TOKEN,
      chatId: input.env.TELEGRAM_ADMIN_CHAT_ID,
      text: [
        "FOMO copilot recall audit",
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
