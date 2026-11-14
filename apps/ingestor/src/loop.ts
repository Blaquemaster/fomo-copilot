import {
  BACKFILL_MAX_SLOT_SPAN,
  BACKFILL_PAGE_CAP,
  BoundedSet,
  DisposableBag,
  IngestRepository,
  LIVENESS_CRITICAL_MS,
  LIVENESS_WARN_MS,
  WATCHED_PROGRAMS,
  allowanceCredits,
  backoffDelayMs,
  backfillStopSlot,
  budgetLevel,
  backfillGapReason,
  decodeRpcTransaction,
  isHighVolumeProgram,
  parsedNamesForProgram,
  livenessLevel,
  measureReconnectGap,
  MICROS_PER_CREDIT,
  isUnrecoveredGap,
  nextReconnectAlert,
  parsedEventMicros,
  persistedSlotIsUsable,
  parseLogsNotification,
  parseParsedNotification,
  parseSlotNotification,
  parseTransactionNotification,
  parseSlotResponse,
  planBackfillPage,
  PARSED_INSTRUCTION_NAMES,
  planCandidateWrites,
  selectBackfillTxCap,
  shouldSkipListedSignature,
  redactString,
  rpcCreditMicros,
  selectWsMethod,
  sendTelegramMessage,
  SignatureWindow,
  signaturesToRecover,
  truncateTelegramText,
  usageMicros,
  type DecodeFailure,
  type Env,
  type Logger,
  type Observation,
  type ResolvedWsMethod,
} from "@fomo/core";

import WebSocket from "ws";

import {
  getSlot,
  getTransaction,
  heliusRpc,
  scanInstructionHistory,
  type RpcMeter,
} from "./helius.js";

const MAX_FRAME_CHARS = 100_000;
const MAX_QUEUED_FRAMES = 2;
const STATUS_MS = 15_000;
/** Helius drops a parsed-stream socket the client has not written to for 5 minutes. */
const KEEPALIVE_MS = 60_000;
const LIVENESS_TICK_MS = 5_000;
const NOTED_NOTIFICATIONS = 32;

interface ReconnectGap {
  gapSeconds: number | null;
  gapSlots: number | null;
  untilSlot: number | null;
  tipSlot: number | null;
  /** Set when a stored live slot is too old for the credit cap to cover. */
  staleFromSlot?: number | null;
  /** True when untilSlot came from ingest_status after a restart. */
  fromPersistedSlot?: boolean;
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  ping?: () => void;
}

export interface IngestDeps {
  openSocket?: (url: string) => SocketLike;
  callRpc?: (method: string, params: unknown[]) => Promise<unknown>;
  now?: () => number;
  warnMs?: number;
  criticalMs?: number;
  livenessTickMs?: number;
  pageCap?: number;
  txCap?: number;
  /** How often to write a WebSocket ping and a JSON-RPC ping. Default 60s. */
  pingMs?: number;
  /** Heap sample interval. Default 5 minutes. Zero disables it. */
  heapSampleMs?: number;
  scanHistory?: typeof scanInstructionHistory;
}

interface LiveCursor {
  atMs: number | null;
  slot: number | null;
}

export async function runIngestLoop(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  deps?: IngestDeps;
}): Promise<void> {
  const secrets = [
    input.env.HELIUS_API_KEY,
    input.env.TELEGRAM_BOT_TOKEN,
    input.env.POSTGRES_PASSWORD,
  ];
  let attempt = 0;
  let outageAlerted = false;
  const choice = { method: selectWsMethod(input.env.HELIUS_PLAN, input.env.HELIUS_WS_MODE) };
  const live: LiveCursor = { atMs: null, slot: null };
  if (input.env.HELIUS_WS_MODE === "enhanced" && choice.method === "parsed") {
    input.logger.warn(
      { plan: input.env.HELIUS_PLAN },
      "enhanced websockets are not used on this plan; using the filtered parsed stream",
    );
  }
  const heapMs = input.deps?.heapSampleMs ?? 5 * 60 * 1000;
  const heapTimer =
    heapMs > 0
      ? setInterval(() => {
          void recordHeapSample(input.repo, input.logger);
        }, heapMs)
      : null;
  input.signal.addEventListener(
    "abort",
    () => {
      if (heapTimer) clearInterval(heapTimer);
    },
    { once: true },
  );
  while (!input.signal.aborted) {
    let opened = false;
    try {
      await runSocket({
        ...input,
        choice,
        secrets,
        live,
        onOpen: () => {
          opened = true;
        },
      });
      outageAlerted = nextReconnectAlert({ opened: true, outageAlerted }).outageAlerted;
      attempt = 0;
    } catch (error) {
      if (input.signal.aborted) break;
      const decision = nextReconnectAlert({ opened, outageAlerted });
      outageAlerted = decision.outageAlerted;
      const message = error instanceof Error ? error.message : "socket closed";
      if (decision.alert) {
        input.logger.error({ err: error }, "helius reconnect failed");
        await notify(
          input,
          secrets,
          `FOMO copilot ingest reconnect failed\n${redactString(message, secrets)}`,
        );
      } else {
        input.logger.warn({ err: error }, "helius websocket closed; reconnecting");
      }
      attempt += 1;
      await sleep(backoffDelayMs(attempt), input.signal);
    }
  }
  if (heapTimer) clearInterval(heapTimer);
}

async function runSocket(input: {
  env: Env;
  logger: Logger;
  repo: IngestRepository;
  signal: AbortSignal;
  choice: { method: ResolvedWsMethod };
  secrets: string[];
  live: LiveCursor;
  deps?: IngestDeps;
  onOpen: () => void;
}): Promise<void> {
  const now = input.deps?.now ?? Date.now;
  const ws = openSocket(input);
  const seen = new SignatureWindow();
  const method = input.choice.method;
  const bag = new DisposableBag();
  let dead = false;
  let lastEvidenceAtMs: number | null = null;
  let lastSlot = input.live.slot;
  const meter = makeMeter(input.repo, input.logger);
  let probeId = 1000;
  let outstandingProbe: number | null = null;
  let keepaliveId: number | null = null;
  let connectedAtMs = 0;

  const touch = (slot?: number): void => {
    lastEvidenceAtMs = now();
    input.live.atMs = lastEvidenceAtMs;
    if (slot !== undefined) {
      lastSlot = slot;
      input.live.slot = slot;
    }
  };

  const sendProbe = (): void => {
    if (ws.readyState !== 1) return;
    probeId += 1;
    outstandingProbe = probeId;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: probeId, method: "getSlot" }));
    meter("getSlot");
  };
  const sendKeepalive = (): void => {
    if (ws.readyState !== 1) return;
    if (typeof ws.ping === "function") ws.ping();
    probeId += 1;
    keepaliveId = probeId;
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: probeId, method: "ping" }));
  };

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
    input.onOpen();
    let chain = Promise.resolve();
    let queued = 0;
    const onMessage = (event: { data?: unknown }): void => {
      if (queued >= MAX_QUEUED_FRAMES) return;
      queued += 1;
      chain = chain
        .then(() => onFrame(event))
        .catch((error: unknown) => {
          input.logger.error({ err: error }, "failed to handle helius frame");
        })
        .finally(() => {
          queued -= 1;
        });
    };
    ws.addEventListener("message", onMessage);
    bag.add(() => {
      ws.removeEventListener("message", onMessage);
    });
    const onPong = (): void => {
      touch();
    };
    ws.addEventListener("pong", onPong);
    bag.add(() => {
      ws.removeEventListener("pong", onPong);
    });
    subscribe(ws, method);
    const gap = await readGap(input, meter);
    connectedAtMs = now();
    touch();
    await input.repo.addUsage({
      now: new Date(),
      streamedBytes: 0n,
      messages: 0,
      storedEvents: 0,
      creditMicros: 0n,
    });
    for (const programId of WATCHED_PROGRAMS) {
      input.logger.info({ method, programId }, "subscription requested");
    }
    input.logger.info(
      { method, plan: input.env.HELIUS_PLAN, mode: input.env.INGEST_MODE },
      "helius subscription started",
    );
    startTimers({
      ws,
      input,
      bag,
      now,
      method,
      connectedAtMs: () => connectedAtMs,
      lastEvidence: () => lastEvidenceAtMs,
      lastSlot: () => lastSlot,
      sendProbe,
      sendKeepalive,
      markDead: () => {
        dead = true;
      },
    });
    await backfillOnConnect({
      env: input.env,
      repo: input.repo,
      logger: input.logger,
      seen,
      meter,
      gap,
      deps: input.deps,
    }).catch((error: unknown) => {
      input.logger.warn({ err: error }, "backfill failed");
    });
    await Promise.race([closed, abortPromise(input.signal)]);
    if (dead) throw new Error("helius websocket dead");
  } finally {
    bag.dispose();
    if (ws.readyState === 1 || ws.readyState === 0) ws.close();
  }
  if (!input.signal.aborted) throw new Error("helius websocket closed");

  async function onFrame(event: { data?: unknown }): Promise<void> {
    const text = await frameText(event.data);
    await handleText(text, {
      ...input,
      method,
      seen,
      meter,
      outstandingProbe: () => outstandingProbe,
      outstandingKeepalive: () => keepaliveId,
      onEvidence: touch,
      onRejectEnhanced: () => {
        input.choice.method = "parsed";
        input.logger.warn(
          {},
          "enhanced subscription rejected; reconnecting with the filtered stream",
        );
        ws.close();
      },
    });
  }
}

function startTimers(input: {
  ws: SocketLike;
  input: {
    env: Env;
    logger: Logger;
    repo: IngestRepository;
    deps?: IngestDeps;
  };
  bag: DisposableBag;
  now: () => number;
  method: ResolvedWsMethod;
  connectedAtMs: () => number;
  lastEvidence: () => number | null;
  lastSlot: () => number | null;
  sendProbe: () => void;
  sendKeepalive: () => void;
  markDead: () => void;
}): void {
  const warnMs = input.input.deps?.warnMs ?? LIVENESS_WARN_MS;
  const criticalMs = input.input.deps?.criticalMs ?? LIVENESS_CRITICAL_MS;
  const tickMs = input.input.deps?.livenessTickMs ?? LIVENESS_TICK_MS;
  const pingMs = input.input.deps?.pingMs ?? KEEPALIVE_MS;
  input.bag.interval(() => {
    input.sendKeepalive();
  }, pingMs);
  let warned = false;
  input.bag.interval(() => {
    const level = livenessLevel({
      nowMs: input.now(),
      connectedAtMs: input.connectedAtMs(),
      lastEvidenceAtMs: input.lastEvidence(),
      warnMs,
      criticalMs,
    });
    if (level === "ok") {
      warned = false;
      return;
    }
    if (level === "warn") {
      if (warned) return;
      warned = true;
      input.input.logger.warn(
        { warnMs, criticalMs },
        "helius websocket liveness degraded; probing with getSlot",
      );
      input.sendProbe();
      return;
    }
    input.input.logger.error({ criticalMs }, "helius websocket liveness critical; reconnecting");
    input.markDead();
    input.ws.close();
  }, tickMs);
  input.bag.interval(() => {
    const paused = false;
    void input.input.repo
      .writeStatus({
        state: "connected",
        wsMethod: input.method,
        plan: input.input.env.HELIUS_PLAN,
        mode: input.input.env.INGEST_MODE,
        paused,
        lastSlot: input.lastSlot(),
        lastError: null,
        now: new Date(),
      })
      .catch((error: unknown) => {
        input.input.logger.error({ err: error }, "failed to write ingest status");
      });
  }, STATUS_MS);
}

async function handleText(
  text: string,
  input: {
    env: Env;
    logger: Logger;
    repo: IngestRepository;
    method: ResolvedWsMethod;
    seen: SignatureWindow;
    meter: RpcMeter;
    secrets: string[];
    deps?: IngestDeps;
    outstandingProbe: () => number | null;
    outstandingKeepalive: () => number | null;
    onEvidence: (slot?: number) => void;
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
      creditMicros:
        input.method === "parsed" && text.includes("parsedTransactionNotification")
          ? parsedEventMicros(1)
          : input.method === "parsed"
            ? 0n
            : usageMicros({ streamedBytes: bytes, rpcCalls: 0 }),
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
  const slotNote = parseSlotNotification(message);
  if (slotNote !== null) {
    input.onEvidence(slotNote);
    await recordFrame(input.repo, bytes, 0n);
    return;
  }
  const keepalive = input.outstandingKeepalive();
  if (keepalive !== null) {
    const reply = rpcReply(message, keepalive);
    if (reply.matched) {
      input.onEvidence(reply.slot ?? undefined);
      await recordFrame(input.repo, bytes, 0n);
      return;
    }
  }
  const probe = input.outstandingProbe();
  if (probe !== null) {
    const probed = parseSlotResponse(message, probe);
    if (probed !== null) {
      input.onEvidence(probed);
      await recordFrame(input.repo, bytes, 0n);
      return;
    }
    if (isRecord(message) && message["id"] === probe && message["error"]) {
      input.onEvidence();
      await recordFrame(input.repo, bytes, 0n);
      return;
    }
  }
  if (isRecord(message) && message["error"] && message["id"] === 1 && input.method === "enhanced") {
    input.onRejectEnhanced();
  }
  const frame =
    input.method === "parsed"
      ? parseParsedNotification(message, Number(bytes))
      : (parseTransactionNotification(message, Number(bytes)) ??
        parseLogsNotification(message, Number(bytes)));
  const parsedEvent = isRecord(message) && message["method"] === "parsedTransactionNotification";
  await input.repo.addUsage({
    now: new Date(),
    streamedBytes: bytes,
    messages: 1,
    storedEvents: 0,
    creditMicros:
      input.method === "parsed"
        ? parsedEvent
          ? parsedEventMicros(1)
          : 0n
        : usageMicros({ streamedBytes: bytes, rpcCalls: 0 }),
  });
  if (!frame) {
    if (isRecord(message) && typeof message["result"] === "number") {
      input.logger.info(
        { subscription: message["result"], request: message["id"] },
        "subscription confirmed",
      );
    } else if (isRecord(message) && typeof message["method"] === "string") {
      noteIgnored(input.logger, message["method"]);
    }
    return;
  }
  if (frame.slot > 0) input.onEvidence(frame.slot);
  const paused = await refreshBudget(input);
  let observations = frame.observations;
  let failures = frame.failures;
  const needsBody =
    observations.some(
      (observation) => observation.pool === null && observation.kind !== "dbc_curve_complete",
    ) ||
    (observations.length === 0 && failures.length > 0);
  if (!paused && needsBody) {
    const enriched = await enrichFromRpc(input, frame.signature);
    if (enriched.observations.length > 0) observations = enriched.observations;
    failures = [...failures, ...enriched.failures];
  }
  await persistDecoded(input, { observations, failures }, Number(bytes));
}

async function recordFrame(
  repo: IngestRepository,
  bytes: bigint,
  creditMicros: bigint,
): Promise<void> {
  await repo.addUsage({
    now: new Date(),
    streamedBytes: bytes,
    messages: 1,
    storedEvents: 0,
    creditMicros,
  });
}

async function persistDecoded(
  input: { repo: IngestRepository; logger: Logger; seen: SignatureWindow },
  decoded: { observations: Observation[]; failures: DecodeFailure[] },
  byteLength: number,
): Promise<number> {
  for (const failure of decoded.failures) {
    try {
      await input.repo.insertDecodeFailure(failure, new Date());
    } catch (error) {
      input.logger.error({ err: error }, "failed to store decode failure");
    }
  }
  let stored = 0;
  for (const observation of decoded.observations) {
    if (!input.seen.add(observation.signature, observation.eventIndex)) continue;
    const inserted = await input.repo.insertRaw(
      observation,
      observation.eventIndex === 0 ? byteLength : 0,
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
  return stored;
}

async function enrichFromRpc(
  input: { env: Env; repo: IngestRepository; logger: Logger; meter: RpcMeter; deps?: IngestDeps },
  signature: string,
): Promise<{ observations: Observation[]; failures: DecodeFailure[] }> {
  try {
    const result = await callRpc(input, "getTransaction", [signature]);
    if (result == null) return { observations: [], failures: [] };
    return decodeRpcTransaction(result, signature);
  } catch (error) {
    input.logger.warn({ err: error }, "getTransaction failed");
    return { observations: [], failures: [] };
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
  secrets: string[];
  logger: Logger;
}): Promise<boolean> {
  const allowance = allowanceCredits(input.env.HELIUS_PLAN, input.env.HELIUS_MONTHLY_CREDITS);
  const now = new Date();
  const month = await input.repo.monthUsage(now);
  const level = budgetLevel(month.creditMicros, allowance);
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
  seen?: SignatureWindow;
  meter?: RpcMeter;
  gap?: ReconnectGap;
  deps?: IngestDeps;
}): Promise<void> {
  const gap = input.gap ?? { gapSeconds: null, gapSlots: null, untilSlot: null, tipSlot: null };
  const seen = input.seen ?? new SignatureWindow();
  const meter = input.meter ?? makeMeter(input.repo, input.logger);
  if (input.paused) return;
  const checkpoint = await input.repo.checkpoint(input.programId);
  if (checkpoint === null) {
    await input.repo.insertBackfill({
      observedAt: new Date(),
      programId: input.programId,
      gapSeconds: gap.gapSeconds,
      gapSlots: gap.gapSlots,
      eventsRecovered: 0,
      pagesFetched: 0,
      signaturesSeen: 0,
      transactionsFetched: 0,
      reachedCheckpoint: true,
      creditCapHit: false,
      unrecovered: false,
      gapFromSlot: null,
      gapToSlot: null,
      reason: null,
    });
    return;
  }
  const pageCap = input.deps?.pageCap ?? BACKFILL_PAGE_CAP;
  const txCap = selectBackfillTxCap({
    fromPersistedSlot: gap.fromPersistedSlot === true,
    override: input.deps?.txCap,
  });
  const liveStop =
    gap.untilSlot === null ? null : backfillStopSlot(gap.untilSlot, input.env.BACKFILL_SLOT_MARGIN);
  const gapFromSlot = liveStop ?? checkpoint.slot;
  if (isHighVolumeProgram(input.programId) && gap.staleFromSlot != null && liveStop === null) {
    input.logger.warn(
      {
        programId: input.programId,
        gapFromSlot: gap.staleFromSlot,
        gapToSlot: gap.tipSlot,
        reason: "too_old",
      },
      "backfill unrecovered gap",
    );
    await input.repo.insertBackfill({
      observedAt: new Date(),
      programId: input.programId,
      gapSeconds: gap.gapSeconds,
      gapSlots: gap.gapSlots,
      eventsRecovered: 0,
      pagesFetched: 0,
      signaturesSeen: 0,
      transactionsFetched: 0,
      reachedCheckpoint: false,
      creditCapHit: false,
      unrecovered: true,
      gapFromSlot: gap.staleFromSlot,
      gapToSlot: gap.tipSlot,
      reason: "too_old",
    });
    return;
  }
  if (liveStop !== null && isHighVolumeProgram(input.programId)) {
    await backfillByScan({ ...input, seen, gap, liveStop, gapFromSlot });
    return;
  }
  let before: string | undefined;
  let pages = 0;
  const missing: string[] = [];
  let reached = false;
  let capHit = false;
  let errored = false;
  let newestSlot: number | null = null;
  const listedNames = new Map<string, readonly string[]>();
  try {
    while (pages < pageCap) {
      pages += 1;
      const page = await getSignatures(input, input.programId, before, meter);
      for (const row of page.rows) {
        if (row.slot !== null && (newestSlot === null || row.slot > newestSlot))
          newestSlot = row.slot;
        if (row.instructionNames && row.instructionNames.length > 0) {
          listedNames.set(row.signature, row.instructionNames);
        }
      }
      const step = planBackfillPage({
        newestFirst: page.rows,
        checkpoint: liveStop === null ? checkpoint.signature : null,
        checkpointSlot: liveStop === null ? checkpoint.slot : null,
        untilSlot: liveStop,
        pageWasFull: page.rawLength >= 100,
        pagesFetched: pages,
        maxPages: pageCap,
      });
      missing.push(...step.missing);
      if (!step.fetchAnotherPage) {
        reached = !step.gapRemains;
        capHit = step.gapRemains;
        break;
      }
      before = page.oldestSignature ?? undefined;
      if (!before) {
        capHit = true;
        break;
      }
    }
  } catch (error) {
    const gapToSlot = newestSlot ?? gap.tipSlot;
    input.logger.warn(
      { err: error, programId: input.programId, gapFromSlot, gapToSlot },
      "backfill unrecovered gap",
    );
    await input.repo.insertBackfill({
      observedAt: new Date(),
      programId: input.programId,
      gapSeconds: gap.gapSeconds,
      gapSlots: gap.gapSlots,
      eventsRecovered: 0,
      pagesFetched: pages,
      signaturesSeen: missing.length,
      transactionsFetched: 0,
      reachedCheckpoint: false,
      creditCapHit: true,
      unrecovered: true,
      gapFromSlot,
      gapToSlot,
      reason: backfillGapReason({
        unrecovered: true,
        errored: true,
        truncated: false,
        reachedStop: false,
        tooOld: gap.staleFromSlot != null,
        highVolumeSkipped: false,
      }),
    });
    return;
  }
  const selected = signaturesToRecover({ missingNewestFirst: missing, txCap });
  const known = await input.repo.knownSignatures(selected.signatures);
  let eventsRecovered = 0;
  let transactionsFetched = 0;
  for (const signature of selected.signatures) {
    if (known.has(signature)) continue;
    const listed = listedNames.get(signature);
    if (
      shouldSkipListedSignature({
        instructionNames: listed,
        watchedNames: PARSED_INSTRUCTION_NAMES,
      })
    ) {
      continue;
    }
    try {
      const result = await callRpc({ env: input.env, meter, deps: input.deps }, "getTransaction", [
        signature,
      ]);
      transactionsFetched += 1;
      if (result == null) continue;
      const decoded = decodeRpcTransaction(result, signature);
      eventsRecovered += await persistDecoded(
        { repo: input.repo, logger: input.logger, seen },
        decoded,
        0,
      );
    } catch (error) {
      errored = true;
      input.logger.warn({ err: error }, "backfill getTransaction failed");
    }
  }
  const creditCapHit = capHit || selected.truncated;
  const unrecovered =
    gap.staleFromSlot != null ||
    isUnrecoveredGap({
      reachedStop: reached,
      truncated: selected.truncated,
      errored,
    });
  const gapFromSlotReported = gap.staleFromSlot ?? gapFromSlot;
  const gapToSlot =
    gap.staleFromSlot != null ? (gap.tipSlot ?? newestSlot) : (newestSlot ?? gap.tipSlot);
  if (unrecovered) {
    input.logger.warn(
      {
        programId: input.programId,
        gapFromSlot: gapFromSlotReported,
        gapToSlot,
        eventsRecovered,
        transactionsFetched,
        creditCapHit,
      },
      "backfill unrecovered gap",
    );
  }
  input.logger.info(
    {
      programId: input.programId,
      gapSeconds: gap.gapSeconds,
      gapSlots: gap.gapSlots,
      eventsRecovered,
      pagesFetched: pages,
      signaturesSeen: missing.length,
      transactionsFetched,
      reachedCheckpoint: reached,
      creditCapHit,
      unrecovered,
      gapFromSlot: gapFromSlotReported,
      gapToSlot,
    },
    "backfill finished",
  );
  await input.repo.insertBackfill({
    observedAt: new Date(),
    programId: input.programId,
    gapSeconds: gap.gapSeconds,
    gapSlots: gap.gapSlots,
    eventsRecovered,
    pagesFetched: pages,
    signaturesSeen: missing.length,
    transactionsFetched,
    reachedCheckpoint: reached,
    creditCapHit,
    unrecovered,
    gapFromSlot: gapFromSlotReported,
    gapToSlot,
    reason: backfillGapReason({
      unrecovered,
      errored,
      truncated: selected.truncated,
      reachedStop: reached,
      tooOld: gap.staleFromSlot != null,
      highVolumeSkipped: false,
    }),
  });
}

async function backfillByScan(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  programId: string;
  seen: SignatureWindow;
  gap: ReconnectGap;
  liveStop: number;
  gapFromSlot: number;
  deps?: IngestDeps;
}): Promise<void> {
  const names = parsedNamesForProgram(input.programId);
  const scan = input.deps?.scanHistory ?? scanInstructionHistory;
  let scanned: Awaited<ReturnType<typeof scanInstructionHistory>>;
  try {
    scanned = await scan({
      apiKey: input.env.HELIUS_API_KEY,
      programId: input.programId,
      instructionNames: names,
      slotGt: input.liveStop,
      slotLte: input.gap.tipSlot,
    });
  } catch (error) {
    input.logger.warn(
      {
        err: error,
        programId: input.programId,
        gapFromSlot: input.gap.staleFromSlot ?? input.gapFromSlot,
        gapToSlot: input.gap.tipSlot,
        reason: "high_volume_skipped",
      },
      "backfill unrecovered gap",
    );
    await input.repo.insertBackfill({
      observedAt: new Date(),
      programId: input.programId,
      gapSeconds: input.gap.gapSeconds,
      gapSlots: input.gap.gapSlots,
      eventsRecovered: 0,
      pagesFetched: 0,
      signaturesSeen: 0,
      transactionsFetched: 0,
      reachedCheckpoint: false,
      creditCapHit: false,
      unrecovered: true,
      gapFromSlot: input.gap.staleFromSlot ?? input.gapFromSlot,
      gapToSlot: input.gap.tipSlot,
      reason: "high_volume_skipped",
    });
    return;
  }
  await input.repo.addUsage({
    now: new Date(),
    streamedBytes: 0n,
    messages: 0,
    storedEvents: 0,
    creditMicros: BigInt(scanned.creditsCharged) * MICROS_PER_CREDIT,
  });
  const known = await input.repo.knownSignatures(scanned.matches.map((match) => match.signature));
  let eventsRecovered = 0;
  let transactionsFetched = 0;
  let errored = false;
  for (const match of scanned.matches) {
    if (known.has(match.signature)) continue;
    try {
      const result = await callRpc(
        { env: input.env, deps: input.deps, meter: makeMeter(input.repo, input.logger) },
        "getTransaction",
        [match.signature],
      );
      transactionsFetched += 1;
      if (result == null) continue;
      const decoded = decodeRpcTransaction(result, match.signature);
      eventsRecovered += await persistDecoded(
        { repo: input.repo, logger: input.logger, seen: input.seen },
        decoded,
        0,
      );
    } catch (error) {
      errored = true;
      input.logger.warn({ err: error }, "backfill getTransaction failed");
    }
  }
  const unrecovered = !scanned.complete || errored || input.gap.staleFromSlot != null;
  const reason = backfillGapReason({
    unrecovered,
    errored,
    truncated: !scanned.complete,
    reachedStop: scanned.complete,
    tooOld: input.gap.staleFromSlot != null,
    highVolumeSkipped: false,
  });
  const gapFromSlot = input.gap.staleFromSlot ?? input.gapFromSlot;
  const gapToSlot = input.gap.tipSlot;
  if (unrecovered) {
    input.logger.warn(
      {
        programId: input.programId,
        gapFromSlot,
        gapToSlot,
        eventsRecovered,
        transactionsFetched,
        creditsCharged: scanned.creditsCharged,
        reason,
      },
      "backfill unrecovered gap",
    );
  }
  input.logger.info(
    {
      programId: input.programId,
      gapSeconds: input.gap.gapSeconds,
      gapSlots: input.gap.gapSlots,
      eventsRecovered,
      transactionsFetched,
      signaturesSeen: scanned.matches.length,
      creditsCharged: scanned.creditsCharged,
      unrecovered,
      reason,
    },
    "backfill finished",
  );
  await input.repo.insertBackfill({
    observedAt: new Date(),
    programId: input.programId,
    gapSeconds: input.gap.gapSeconds,
    gapSlots: input.gap.gapSlots,
    eventsRecovered,
    pagesFetched: 0,
    signaturesSeen: scanned.matches.length,
    transactionsFetched,
    reachedCheckpoint: scanned.complete,
    creditCapHit: !scanned.complete,
    unrecovered,
    gapFromSlot,
    gapToSlot,
    reason,
  });
}

async function getSignatures(
  input: { env: Env; deps?: IngestDeps },
  programId: string,
  before: string | undefined,
  meter: RpcMeter,
): Promise<{
  rawLength: number;
  oldestSignature: string | null;
  rows: Array<{
    signature: string;
    slot: number | null;
    failed?: boolean;
    instructionNames: readonly string[] | null;
  }>;
}> {
  const config: Record<string, unknown> = { limit: 100, commitment: "confirmed" };
  if (before) config["before"] = before;
  const result = await callRpc(
    { env: input.env, meter, deps: input.deps },
    "getSignaturesForAddress",
    [programId, config],
  );
  if (!Array.isArray(result)) return { rawLength: 0, oldestSignature: null, rows: [] };
  const rows: Array<{
    signature: string;
    slot: number | null;
    failed?: boolean;
    instructionNames: readonly string[] | null;
  }> = [];
  let oldestSignature: string | null = null;
  for (const row of result) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as {
      signature?: unknown;
      slot?: unknown;
      err?: unknown;
      instructionNames?: unknown;
    };
    if (typeof record.signature !== "string") continue;
    oldestSignature = record.signature;
    const names = Array.isArray(record.instructionNames)
      ? record.instructionNames.filter((name): name is string => typeof name === "string")
      : null;
    rows.push({
      signature: record.signature,
      slot: typeof record.slot === "number" ? record.slot : null,
      failed: record.err != null,
      instructionNames: names && names.length > 0 ? names : null,
    });
  }
  return { rawLength: result.length, oldestSignature, rows };
}

function subscribe(ws: SocketLike, method: ResolvedWsMethod): void {
  if (ws.readyState !== 1) return;
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
  } else {
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "parsedTransactionSubscribe",
        params: [
          {
            programs: [...WATCHED_PROGRAMS],
            instructionNames: [...PARSED_INSTRUCTION_NAMES],
            includeFailed: false,
            includeCpi: true,
          },
          { commitment: "confirmed", details: "matched" },
        ],
      }),
    );
  }
  ws.send(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "slotSubscribe" }));
}

async function readGap(
  input: {
    env: Env;
    logger: Logger;
    repo: IngestRepository;
    live: LiveCursor;
    deps?: IngestDeps;
  },
  meter: RpcMeter,
): Promise<ReconnectGap> {
  const now = input.deps?.now ?? Date.now;
  const lastLiveAtMs = input.live.atMs;
  let lastSlot = input.live.slot;
  let currentSlot: number | null = null;
  try {
    const result = await callRpc({ env: input.env, meter, deps: input.deps }, "getSlot", [
      { commitment: "confirmed" },
    ]);
    currentSlot = typeof result === "number" ? result : null;
  } catch (error) {
    input.logger.warn({ err: error }, "getSlot failed");
  }
  let staleFromSlot: number | null = null;
  let fromPersistedSlot = false;
  if (lastSlot === null) {
    const persisted = await input.repo.lastLiveSlot();
    if (
      persistedSlotIsUsable({
        persistedSlot: persisted,
        tipSlot: currentSlot,
        margin: input.env.BACKFILL_SLOT_MARGIN,
        maxSpan: BACKFILL_MAX_SLOT_SPAN,
      })
    ) {
      lastSlot = persisted;
      fromPersistedSlot = true;
      input.logger.info(
        { persistedSlot: persisted, tipSlot: currentSlot },
        "startup backfill bounded by persisted live slot",
      );
    } else if (persisted !== null) {
      staleFromSlot = backfillStopSlot(persisted, input.env.BACKFILL_SLOT_MARGIN);
      input.logger.warn(
        { persistedSlot: persisted, tipSlot: currentSlot, gapFromSlot: staleFromSlot },
        "persisted live slot is older than the backfill cap",
      );
    }
  }
  return {
    ...measureReconnectGap({
      nowMs: now(),
      lastLiveAtMs,
      lastSlot,
      currentSlot,
    }),
    staleFromSlot,
    fromPersistedSlot,
  };
}

export async function recordHeapSample(repo: IngestRepository, logger: Logger): Promise<void> {
  const memory = process.memoryUsage();
  const uptimeSec = Math.round(process.uptime());
  logger.info(
    {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      uptimeSec,
    },
    "ingest heap sample",
  );
  try {
    await repo.insertHeapSample({
      sampledAt: new Date(),
      uptimeSec,
      rssBytes: memory.rss,
      heapTotalBytes: memory.heapTotal,
      heapUsedBytes: memory.heapUsed,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    });
  } catch (error) {
    logger.error({ err: error }, "failed to store heap sample");
  }
}

async function callRpc(
  input: { env: Env; meter: RpcMeter; deps?: IngestDeps },
  method: string,
  params: unknown[],
): Promise<unknown> {
  if (input.deps?.callRpc) {
    input.meter(method);
    return input.deps.callRpc(method, params);
  }
  if (method === "getTransaction" && typeof params[0] === "string") {
    return getTransaction(input.env.HELIUS_API_KEY, params[0], input.meter);
  }
  if (method === "getSlot") return getSlot(input.env.HELIUS_API_KEY, input.meter);
  return heliusRpc({
    apiKey: input.env.HELIUS_API_KEY,
    method,
    params,
    meter: input.meter,
  });
}

function makeMeter(repo: IngestRepository, logger: Logger): RpcMeter {
  return (method: string) => {
    void repo
      .addUsage({
        now: new Date(),
        streamedBytes: 0n,
        messages: 0,
        storedEvents: 0,
        creditMicros: rpcCreditMicros(method),
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, "failed to meter helius credits");
      });
  };
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

function openSocket(input: {
  env: Env;
  choice: { method: ResolvedWsMethod };
  deps?: IngestDeps;
}): SocketLike {
  const url = websocketUrlSafe(input.env.HELIUS_API_KEY, input.choice.method);
  if (input.deps?.openSocket) return input.deps.openSocket(url);
  return wrapWs(new WebSocket(url));
}

function wrapWs(socket: WebSocket): SocketLike {
  const wrappers = new Map<(event: { data?: unknown }) => void, (...args: unknown[]) => void>();
  const emitter = socket as unknown as {
    on(type: string, listener: (...args: unknown[]) => void): void;
    off(type: string, listener: (...args: unknown[]) => void): void;
  };
  return {
    get readyState() {
      return socket.readyState;
    },
    send(data: string) {
      socket.send(data);
    },
    close() {
      socket.close();
    },
    ping() {
      socket.ping();
    },
    addEventListener(type, listener, options) {
      const wrapped = (...args: unknown[]) => {
        if (type === "message") listener({ data: args[0] });
        else listener({});
        if (options?.once) {
          emitter.off(type, wrapped);
          wrappers.delete(listener);
        }
      };
      wrappers.set(listener, wrapped);
      emitter.on(type, wrapped);
    },
    removeEventListener(type, listener) {
      const wrapped = wrappers.get(listener);
      if (!wrapped) return;
      emitter.off(type, wrapped);
      wrappers.delete(listener);
    },
  };
}

function rpcReply(message: unknown, id: number): { matched: boolean; slot: number | null } {
  if (!isRecord(message) || message["id"] !== id) return { matched: false, slot: null };
  if (typeof message["result"] === "number") return { matched: true, slot: message["result"] };
  const result = isRecord(message["result"]) ? message["result"] : null;
  if (result && typeof result["slot"] === "number") return { matched: true, slot: result["slot"] };
  if (message["error"] !== undefined || message["result"] !== undefined) {
    return { matched: true, slot: null };
  }
  return { matched: false, slot: null };
}

function websocketUrlSafe(apiKey: string, method: ResolvedWsMethod): string {
  const host = method === "parsed" ? "beta.helius-rpc.com" : "mainnet.helius-rpc.com";
  return `wss://${host}/?api-key=${encodeURIComponent(apiKey)}`;
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

const notedNotifications = new BoundedSet(NOTED_NOTIFICATIONS);

function noteIgnored(logger: Logger, method: string): void {
  if (!notedNotifications.add(method)) return;
  logger.info({ notification: method }, "helius notification was not an ingest event");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export { WATCHED_PROGRAMS };

async function backfillOnConnect(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  seen: SignatureWindow;
  meter: RpcMeter;
  gap: ReconnectGap;
  deps?: IngestDeps;
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
