import {
  IngestRepository,
  SignatureWindow,
  WATCHED_PROGRAMS,
  allowanceCredits,
  backoffDelayMs,
  budgetLevel,
  parseLogsNotification,
  parseRpcTransaction,
  parseTransactionNotification,
  planBackfillPage,
  planCandidateWrites,
  redactString,
  selectWsMethod,
  sendTelegramMessage,
  silenceExceeded,
  truncateTelegramText,
  usageMicros,
  type Env,
  type Logger,
  type Observation,
  type ResolvedWsMethod,
} from "@fomo/core";

import { heliusRpc } from "./helius.js";

const MAX_FRAME_CHARS = 2_000_000;
const BACKFILL_MAX_PAGES = 3;
const BACKFILL_MAX_TRANSACTIONS = 20;
const STATUS_MS = 15_000;
const PING_MS = 20_000;

export async function runIngestLoop(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
}): Promise<void> {
  const secrets = [
    input.env.HELIUS_API_KEY,
    input.env.TELEGRAM_BOT_TOKEN,
    input.env.POSTGRES_PASSWORD,
  ];
  let attempt = 0;
  const choice = { method: selectWsMethod(input.env.HELIUS_PLAN, input.env.HELIUS_WS_MODE) };
  if (input.env.HELIUS_WS_MODE === "enhanced" && choice.method === "standard") {
    input.logger.warn(
      { plan: input.env.HELIUS_PLAN },
      "enhanced websockets are not available on this plan; using standard logsSubscribe",
    );
  }
  while (!input.signal.aborted) {
    try {
      await runSocket({ ...input, choice, secrets });
      attempt = 0;
    } catch (error) {
      if (input.signal.aborted) break;
      const message = error instanceof Error ? error.message : "socket closed";
      input.logger.warn({ err: error }, "helius websocket closed");
      if (!message.includes("silent")) {
        await notify(
          input,
          secrets,
          `FOMO copilot ingest disconnected\n${redactString(message, secrets)}`,
        );
      }
      attempt += 1;
      await sleep(backoffDelayMs(attempt), input.signal);
    }
  }
}

async function runSocket(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  choice: { method: ResolvedWsMethod };
  secrets: string[];
}): Promise<void> {
  const ws = new WebSocket(websocketUrlSafe(input.env.HELIUS_API_KEY));
  const seen = new SignatureWindow();
  let method = input.choice.method;
  let lastMessageAt = Date.now();
  let silentClose = false;
  let lastSlot: number | null = null;
  const allowance = allowanceCredits(input.env.HELIUS_PLAN, input.env.HELIUS_MONTHLY_CREDITS);

  const opened = new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("helius websocket failed to open")), {
      once: true,
    });
  });
  const closed = new Promise<void>((resolve) => {
    ws.addEventListener("close", () => resolve(), { once: true });
  });

  try {
    await opened;
    lastMessageAt = Date.now();
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: usageMicros({ streamedBytes: 0n, rpcCalls: 0, socketOpens: 1 }),
    });
    subscribe(ws, method);
    input.logger.info(
      { method, plan: input.env.HELIUS_PLAN, mode: input.env.INGEST_MODE },
      "helius subscription started",
    );
    await backfillOnConnect({ env: input.env, repo: input.repo, logger: input.logger }).catch(
      (error: unknown) => {
        input.logger.warn({ err: error }, "backfill failed");
      },
    );
    const timers = startTimers(
      ws,
      input,
      () => lastMessageAt,
      () => {
        silentClose = true;
      },
      () => ({ method, lastSlot }),
    );
    let chain = Promise.resolve();
    ws.addEventListener("message", (event) => {
      lastMessageAt = Date.now();
      chain = chain
        .then(async () =>
          handleText(await frameText(event.data), {
            ...input,
            method,
            seen,
            allowance,
            onSlot: (slot) => {
              lastSlot = slot;
            },
            onRejectEnhanced: () => {
              method = "standard";
              input.choice.method = "standard";
              input.logger.warn(
                {},
                "transactionSubscribe was rejected; falling back to logsSubscribe",
              );
              subscribe(ws, "standard");
            },
          }),
        )
        .catch((error: unknown) => {
          input.logger.error({ err: error }, "failed to handle helius frame");
        });
    });
    await Promise.race([closed, abortPromise(input.signal)]);
    clearInterval(timers.ping);
    clearInterval(timers.silence);
    clearInterval(timers.status);
    if (silentClose) {
      throw new Error("helius websocket silent");
    }
  } finally {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  }
  if (!input.signal.aborted) {
    throw new Error("helius websocket closed");
  }
}

function startTimers(
  ws: WebSocket,
  input: {
    env: Env;
    logger: Logger;
    repo: IngestRepository;
    signal: AbortSignal;
    secrets: string[];
  },
  lastMessageAt: () => number,
  markSilent: () => void,
  snapshot: () => { method: ResolvedWsMethod; lastSlot: number | null },
): {
  ping: ReturnType<typeof setInterval>;
  silence: ReturnType<typeof setInterval>;
  status: ReturnType<typeof setInterval>;
} {
  let pingId = 1000;
  const ping = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: pingId, method: "ping" }));
    pingId += 1;
  }, PING_MS);
  let alerted = false;
  const silence = setInterval(() => {
    if (
      !silenceExceeded({
        lastMessageAtMs: lastMessageAt(),
        nowMs: Date.now(),
        alreadyAlerted: alerted,
      })
    )
      return;
    alerted = true;
    markSilent();
    void notify(input, input.secrets, "FOMO copilot ingest silent for more than 60s").finally(
      () => {
        ws.close();
      },
    );
  }, 5_000);
  const status = setInterval(() => {
    const snap = snapshot();
    void input.repo
      .writeStatus({
        state: "connected",
        wsMethod: snap.method,
        plan: input.env.HELIUS_PLAN,
        mode: input.env.INGEST_MODE,
        paused: false,
        lastSlot: snap.lastSlot,
        lastError: null,
        now: new Date(),
      })
      .catch((error: unknown) => {
        input.logger.error({ err: error }, "failed to write ingest status");
      });
  }, STATUS_MS);
  return { ping, silence, status };
}

async function handleText(
  text: string,
  input: {
    env: Env;
    logger: Logger;
    repo: IngestRepository;
    method: ResolvedWsMethod;
    seen: SignatureWindow;
    allowance: bigint;
    secrets: string[];
    onSlot: (slot: number) => void;
    onRejectEnhanced: () => void;
  },
): Promise<void> {
  const bytes = BigInt(Buffer.byteLength(text));
  if (text.length > MAX_FRAME_CHARS) {
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: bytes,
      messages: 1,
      storedEvents: 0,
      creditMicros: usageMicros({ streamedBytes: bytes, rpcCalls: 0, socketOpens: 0 }),
    });
    input.logger.warn({ bytes: bytes.toString() }, "dropped oversized helius frame");
    return;
  }
  let message: unknown;
  try {
    message = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (isRecord(message) && message["error"] && message["id"] === 1 && input.method === "enhanced") {
    input.onRejectEnhanced();
  }
  const frame =
    input.method === "enhanced"
      ? (parseTransactionNotification(message, Number(bytes)) ??
        parseLogsNotification(message, Number(bytes)))
      : parseLogsNotification(message, Number(bytes));
  await input.repo.addUsage({
    now: new Date(),
    streamedBytes: bytes,
    messages: 1,
    storedEvents: 0,
    creditMicros: usageMicros({ streamedBytes: bytes, rpcCalls: 0, socketOpens: 0 }),
  });
  if (!frame) {
    if (isRecord(message) && typeof message["method"] === "string")
      noteIgnored(input.logger, message["method"]);
    return;
  }
  input.onSlot(frame.slot);
  const paused = await refreshBudget(input);
  let observations = frame.observations;
  if (
    !paused &&
    observations.some(
      (observation) => observation.pool === null && observation.kind !== "dbc_curve_complete",
    )
  ) {
    observations = await enrichFromRpc(input, frame.signature, observations);
  }
  let stored = 0;
  for (const observation of observations) {
    if (!input.seen.add(observation.signature, observation.eventIndex)) continue;
    const inserted = await input.repo.insertRaw(
      observation,
      observation.eventIndex === 0 ? Number(bytes) : 0,
      new Date(),
    );
    if (!inserted) continue;
    stored += 1;
    await applyOne(input.repo, observation);
    await input.repo.saveCheckpoint(
      observation.programId,
      observation.signature,
      observation.slot,
      new Date(),
    );
  }
  if (stored > 0) {
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: stored,
      creditMicros: 0n,
    });
  }
}

async function enrichFromRpc(
  input: { env: Env; repo: IngestRepository; logger: Logger },
  signature: string,
  current: Observation[],
): Promise<Observation[]> {
  try {
    const result = await heliusRpc({
      apiKey: input.env.HELIUS_API_KEY,
      method: "getTransaction",
      params: [
        signature,
        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ],
    });
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: usageMicros({ streamedBytes: 0n, rpcCalls: 1, socketOpens: 0 }),
    });
    if (result == null) return current;
    const parsed = parseRpcTransaction(result, signature);
    return parsed.length > 0 ? parsed : current;
  } catch (error) {
    input.logger.warn({ err: error }, "getTransaction failed");
    return current;
  }
}

async function applyOne(repo: IngestRepository, observation: Observation): Promise<void> {
  const nowMs = observation.blockTimeMs ?? Date.now();
  const earliest = observation.mint ? await repo.earliestFirstSeenMs(observation.mint) : null;
  const plan = planCandidateWrites({ observation, nowMs, earliestFirstSeenMs: earliest });
  if (plan.candidate) await repo.insertCandidate(plan.candidate);
  if (plan.curve) await repo.markCurve(plan.curve);
  if (plan.graduation) await repo.markGraduation(plan.graduation);
}

async function refreshBudget(input: {
  env: Env;
  repo: IngestRepository;
  allowance: bigint;
  secrets: string[];
  logger: Logger;
}): Promise<boolean> {
  const now = new Date();
  const month = await input.repo.monthUsage(now);
  const level = budgetLevel(month.creditMicros, input.allowance);
  if (level === "warn60" && !month.alerted60) {
    await input.repo.markBudgetAlert(now, "warn60");
    await notify(
      input,
      input.secrets,
      "FOMO copilot Helius credits reached 60% of the monthly allowance",
    );
  } else if (level === "warn80" && !month.alerted80) {
    await input.repo.markBudgetAlert(now, "warn80");
    await notify(
      input,
      input.secrets,
      "FOMO copilot Helius credits reached 80% of the monthly allowance",
    );
  } else if (level === "pause" && !month.paused) {
    await input.repo.markBudgetAlert(now, "pause");
    await notify(
      input,
      input.secrets,
      "FOMO copilot paused non-essential Helius calls at 90% of the monthly allowance",
    );
  }
  return level === "pause";
}

export async function backfillProgram(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  programId: string;
  paused: boolean;
}): Promise<void> {
  if (input.paused) return;
  const checkpoint = await input.repo.checkpoint(input.programId);
  let before: string | undefined;
  let pages = 0;
  const missing: string[] = [];
  let gapRemains = false;
  while (pages < BACKFILL_MAX_PAGES) {
    pages += 1;
    const page = await getSignatures(input.env.HELIUS_API_KEY, input.programId, before);
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: usageMicros({ streamedBytes: 0n, rpcCalls: 1, socketOpens: 0 }),
    });
    const step = planBackfillPage({
      newestFirst: page.map((row) => row.signature),
      checkpoint: checkpoint?.signature ?? null,
      pageWasFull: page.length >= 100,
      pagesFetched: pages,
      maxPages: BACKFILL_MAX_PAGES,
    });
    missing.push(...step.missing);
    gapRemains = step.gapRemains;
    if (!step.fetchAnotherPage) break;
    before = page.at(-1)?.signature;
    if (!before) break;
  }
  if (gapRemains) {
    input.logger.warn(
      { programId: input.programId },
      "signature gap is larger than the backfill window",
    );
  }
  for (const signature of missing.slice(0, BACKFILL_MAX_TRANSACTIONS)) {
    const result = await heliusRpc({
      apiKey: input.env.HELIUS_API_KEY,
      method: "getTransaction",
      params: [
        signature,
        { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 },
      ],
    });
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: usageMicros({ streamedBytes: 0n, rpcCalls: 1, socketOpens: 0 }),
    });
    const observations = parseRpcTransaction(result, signature);
    for (const observation of observations) {
      const inserted = await input.repo.insertRaw(observation, 0, new Date());
      if (!inserted) continue;
      await applyOne(input.repo, observation);
    }
  }
}

async function getSignatures(
  apiKey: string,
  programId: string,
  before: string | undefined,
): Promise<Array<{ signature: string }>> {
  const config: Record<string, unknown> = { limit: 100, commitment: "confirmed" };
  if (before) config["before"] = before;
  const result = await heliusRpc({
    apiKey,
    method: "getSignaturesForAddress",
    params: [programId, config],
  });
  if (!Array.isArray(result)) return [];
  return result
    .map((row) => {
      const record =
        typeof row === "object" && row !== null
          ? (row as { signature?: unknown; err?: unknown })
          : null;
      if (!record || typeof record.signature !== "string" || record.err != null) return null;
      return { signature: record.signature };
    })
    .filter((row): row is { signature: string } => row !== null);
}

function subscribe(ws: WebSocket, method: ResolvedWsMethod): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  if (method === "enhanced") {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "transactionSubscribe",
        params: [
          { accountInclude: [...WATCHED_PROGRAMS], vote: false, failed: false },
          {
            commitment: "confirmed",
            encoding: "jsonParsed",
            transactionDetails: "full",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    );
    return;
  }
  for (const [index, program] of WATCHED_PROGRAMS.entries()) {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: index + 2,
        method: "logsSubscribe",
        params: [{ mentions: [program] }, { commitment: "confirmed" }],
      }),
    );
  }
}

async function notify(
  input: { env: Env; logger: Logger },
  secrets: readonly string[],
  text: string,
): Promise<void> {
  try {
    await sendTelegramMessage({
      token: input.env.TELEGRAM_BOT_TOKEN,
      chatId: input.env.TELEGRAM_ADMIN_CHAT_ID,
      text: truncateTelegramText(redactString(text, secrets)),
    });
  } catch (error) {
    input.logger.error({ err: error }, "failed to send ingest alert");
  }
}

async function frameText(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return Buffer.from(data).toString("utf8");
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.text();
  return "";
}

function websocketUrlSafe(apiKey: string): string {
  return `wss://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`;
}

function abortPromise(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const notedNotifications = new Set<string>();

function noteIgnored(logger: Logger, method: string): void {
  if (notedNotifications.has(method)) return;
  notedNotifications.add(method);
  logger.info({ notification: method }, "helius notification was not an ingest event");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { WATCHED_PROGRAMS, backfillOnConnect };

async function backfillOnConnect(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
}): Promise<void> {
  const month = await input.repo.monthUsage(new Date());
  const allowance = allowanceCredits(input.env.HELIUS_PLAN, input.env.HELIUS_MONTHLY_CREDITS);
  const paused = budgetLevel(month.creditMicros, allowance) === "pause";
  if (paused) {
    input.logger.warn({}, "skipping backfill because non-essential Helius calls are paused");
    return;
  }
  for (const programId of WATCHED_PROGRAMS) {
    await backfillProgram({ ...input, programId, paused: false });
  }
}
