import WebSocket from "ws";

import {
  BSC_CHAIN,
  FLAP_LAUNCHPAD,
  FLAP_LOG_TOPICS,
  FLAP_PORTAL,
  IngestRepository,
  backoffDelayMs,
  decodePortalLog,
  decodeTokenStateV8,
  encodeGetTokenV8Safe,
  type FlapTokenState,
  type Logger,
  type Env,
} from "@fomo/core";

/** PublicNode and Alchemy both accept this page size. */
export const LOG_PAGE_BLOCKS = 500;
/** About one hour of BSC blocks (0.45s each), kept off the in-flight tip. */
const AUDIT_HOUR_BLOCKS = 8_000;
const AUDIT_QUIET_BLOCKS = 20;
const AUDIT_EVERY_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_MS = 20_000;
/** Safety-net eth_getLogs. Inside the 2–5 minute window. */
export const BSC_SWEEP_MS = 3 * 60 * 1000;
/** A quiet head with an empty sweep is not a stall. Missed logs after the checkpoint are. */
export function bscLogStall(input: {
  head: number;
  checkpoint: number;
  missedLogs: number;
}): boolean {
  return input.missedLogs > 0 && input.head > input.checkpoint;
}
/** 30s, 2m, then 10m. getTokenV8Safe often fails in the create block on PublicNode. */
export const ENRICH_RETRY_MS = [30_000, 120_000, 600_000] as const;

/** Never ask a node for a block past the head it just reported. */
export function clampLogRange(
  fromBlock: number,
  toBlock: number,
  head: number,
): { fromBlock: number; toBlock: number } | null {
  if (!Number.isFinite(fromBlock) || !Number.isFinite(toBlock) || !Number.isFinite(head))
    return null;
  const to = Math.min(toBlock, head);
  if (to < fromBlock) return null;
  return { fromBlock, toBlock: to };
}

/** Inclusive pages of at most `size` blocks. The next page repeats the boundary block. */
export function logBlockPages(
  fromBlock: number,
  toBlock: number,
  size = LOG_PAGE_BLOCKS,
): Array<{ fromBlock: number; toBlock: number }> {
  if (toBlock < fromBlock || size < 1) return [];
  const pages: Array<{ fromBlock: number; toBlock: number }> = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const to = Math.min(toBlock, from + size - 1);
    pages.push({ fromBlock: from, toBlock: to });
    if (to >= toBlock) break;
    from = to;
  }
  return pages;
}

export function enrichRetryDelayMs(attempt: number): number | null {
  return ENRICH_RETRY_MS[attempt] ?? null;
}

/**
 * BNB Chain Flap intake. Runs beside Solana and never throws out to it.
 * Trades are not subscribed. One logs subscription, one eth_call per create,
 * and one eth_getLogs per recall. Alchemy free tier is about 30 million
 * compute units a month; a create is one eth_call (26 CU) and a recall is
 * one eth_getLogs (60 CU).
 */
export async function runBscIngest(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  signal: AbortSignal;
  deps?: {
    openSocket?: (url: string) => WebSocket;
    sleep?: (ms: number) => Promise<void>;
  };
}): Promise<void> {
  if (!input.env.BSC_WSS_URL) return;
  let attempt = 1;
  let connected = false;
  while (!input.signal.aborted) {
    try {
      if (connected) {
        const reconnects = await input.repo.noteChainReconnect(BSC_CHAIN);
        input.logger.info({ chain: BSC_CHAIN, reconnects }, "bsc reconnect");
      }
      await connectBsc(input);
      connected = true;
      attempt = 1;
    } catch (error) {
      if (input.signal.aborted) return;
      connected = true;
      input.logger.error({ err: error }, "bsc socket failed");
      const wait = backoffDelayMs(attempt, () => 0);
      attempt += 1;
      await (input.deps?.sleep ?? delay)(wait);
    }
  }
}

export async function handlePortalLog(
  repo: IngestRepository,
  log: PortalLog,
  enrich: (token: string) => Promise<FlapTokenState | null> = async () => null,
): Promise<{ stored: boolean; needsEnrich: boolean; token: string | null }> {
  const topic = log.topics[0];
  if (!topic) return { stored: false, needsEnrich: false, token: null };
  const event = decodePortalLog(topic, log.data);
  if (!event) return { stored: false, needsEnrich: false, token: null };
  const inserted = await repo.insertChainEvent({
    chain: BSC_CHAIN,
    txHash: log.txHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    eventName: event.kind,
    address: event.token,
  });
  if (!inserted) return { stored: false, needsEnrich: false, token: event.token };
  const createdAt = new Date();
  let state: FlapTokenState | null = null;
  if (event.kind === "create") {
    state = await enrich(event.token).catch(() => null);
    const buy = state?.buyTaxBps ?? null;
    const sell = state?.sellTaxBps ?? null;
    await repo.rememberAsset({
      chain: BSC_CHAIN,
      address: event.token,
      launchpad: FLAP_LAUNCHPAD,
      quoteAddress: state?.quoteToken ?? null,
      taxBps: buy === null && sell === null ? null : Math.max(buy ?? 0, sell ?? 0),
      buyTaxBps: buy,
      sellTaxBps: sell,
      pool: state && state.pool !== ZERO_ADDRESS ? state.pool : null,
      clPoolId: null,
      creator: event.creator,
      createdBlock: log.blockNumber,
      createdAt,
      txHash: log.txHash,
    });
  } else if (event.kind === "tax") {
    await repo.rememberAsset({
      chain: BSC_CHAIN,
      address: event.token,
      launchpad: FLAP_LAUNCHPAD,
      quoteAddress: null,
      taxBps: event.taxBps,
      buyTaxBps: null,
      sellTaxBps: null,
      pool: null,
      clPoolId: null,
      creator: null,
      createdBlock: log.blockNumber,
      createdAt,
      txHash: log.txHash,
    });
  } else if (event.kind === "launch") {
    await repo.rememberAsset({
      chain: BSC_CHAIN,
      address: event.token,
      launchpad: FLAP_LAUNCHPAD,
      quoteAddress: null,
      taxBps: null,
      buyTaxBps: null,
      sellTaxBps: null,
      pool: event.pool,
      clPoolId: null,
      creator: null,
      createdBlock: null,
      createdAt,
      txHash: log.txHash,
    });
  } else {
    await repo.rememberAsset({
      chain: BSC_CHAIN,
      address: event.token,
      launchpad: FLAP_LAUNCHPAD,
      quoteAddress: null,
      taxBps: null,
      buyTaxBps: null,
      sellTaxBps: null,
      pool: null,
      clPoolId: event.poolId,
      creator: null,
      createdBlock: null,
      createdAt,
      txHash: log.txHash,
    });
  }
  const needsEnrich = event.kind === "create" && enrichmentMissing(state);
  return { stored: true, needsEnrich, token: event.token };
}

export function portalLogFilter(): {
  address: string;
  topics: string[][];
} {
  return { address: FLAP_PORTAL, topics: [[...FLAP_LOG_TOPICS]] };
}

interface PortalLog {
  topics: string[];
  data: string;
  blockNumber: number;
  txHash: string;
  logIndex: number;
}

async function connectBsc(input: {
  env: Env;
  repo: IngestRepository;
  logger: Logger;
  signal: AbortSignal;
  deps?: { openSocket?: (url: string) => WebSocket };
}): Promise<void> {
  const url = input.env.BSC_WSS_URL;
  if (!url) return;
  const ws = input.deps?.openSocket ? input.deps.openSocket(url) : new WebSocket(url);
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  const send = (method: string, params: unknown[]): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error("bsc rpc timed out"));
      }, 20_000);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return result;
  };
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", () => reject(new Error("bsc websocket failed to open")));
  });
  let caughtUp = false;
  const onMessage = (raw: WebSocket.RawData): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message["id"] === "number") {
      const waiter = pending.get(message["id"]);
      if (!waiter) return;
      pending.delete(message["id"]);
      if (message["error"]) {
        const errorRecord = message["error"] as { message?: unknown };
        const text =
          typeof errorRecord.message === "string" ? errorRecord.message : "bsc rpc error";
        waiter.reject(new Error(text));
        return;
      }
      waiter.resolve(message["result"]);
      return;
    }
    if (message["method"] !== "eth_subscription") return;
    const params = message["params"];
    if (!params || typeof params !== "object") return;
    const result = (params as { result?: unknown }).result;
    const log = parseLog(result);
    if (!log) return;
    void acceptLog(input, send, log, () => caughtUp).catch((error: unknown) => {
      input.logger.error({ err: error }, "bsc log failed");
    });
  };
  ws.on("message", onMessage);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let audit: ReturnType<typeof setInterval> | undefined;
  let enrichTimer: ReturnType<typeof setInterval> | undefined;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  let sweeping = false;
  try {
    await send("eth_subscribe", ["logs", portalLogFilter()]);
    input.logger.info({ chain: BSC_CHAIN, portal: FLAP_PORTAL }, "bsc flap subscription started");
    const head = await readHead(send);
    const cursor = await input.repo.chainCheckpoint(BSC_CHAIN);
    const fromBlock = cursor?.blockNumber ?? head;
    await catchUpBscLogs(input, send, fromBlock, head, cursor === null ? head : null);
    caughtUp = true;
    let lastBeat = Date.now();
    heartbeat = setInterval(() => {
      if (typeof ws.ping === "function") ws.ping();
      if (pending.size > 0) return;
      void readHead(send)
        .then(() => {
          lastBeat = Date.now();
        })
        .catch((error: unknown) => {
          input.logger.warn({ err: error }, "bsc heartbeat failed");
          ws.close();
        });
      if (Date.now() - lastBeat > HEARTBEAT_MS * 3) ws.close();
    }, HEARTBEAT_MS);
    sweepTimer = setInterval(() => {
      if (sweeping) return;
      sweeping = true;
      void sweepFromCheckpoint(input, send)
        .then((missed) => {
          const head = missed.head;
          if (
            bscLogStall({
              head: missed.head,
              checkpoint: missed.checkpoint,
              missedLogs: missed.missedLogs,
            })
          ) {
            input.logger.warn(
              { metric: "bsc_log_stall", head, missedLogs: missed.missedLogs },
              "bsc log subscription missed logs; reconnecting",
            );
            ws.close();
          }
        })
        .catch((error: unknown) => {
          input.logger.warn({ err: error }, "bsc log sweep failed");
        })
        .finally(() => {
          sweeping = false;
        });
    }, BSC_SWEEP_MS);
    audit = setInterval(() => {
      void auditBscLogs(input, send).catch((error: unknown) => {
        input.logger.error({ err: error }, "bsc recall failed");
      });
    }, AUDIT_EVERY_MS);
    enrichTimer = setInterval(() => {
      void retryEnrichments(input, send).catch((error: unknown) => {
        input.logger.error({ err: error }, "bsc enrich retry failed");
      });
    }, 10_000);
    await new Promise<void>((resolve) => {
      ws.once("close", () => resolve());
      input.signal.addEventListener("abort", () => ws.close(), { once: true });
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (audit) clearInterval(audit);
    if (enrichTimer) clearInterval(enrichTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    ws.off("message", onMessage);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}

async function acceptLog(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
  log: PortalLog,
  caughtUp: () => boolean,
): Promise<void> {
  const outcome = await handlePortalLog(input.repo, log, (token) => enrich(send, token));
  if (outcome.needsEnrich && outcome.token) await scheduleEnrich(input.repo, outcome.token, 0);
  if (outcome.stored && caughtUp()) {
    await input.repo.saveChainCheckpoint({
      chain: BSC_CHAIN,
      blockNumber: log.blockNumber,
      coverageBlock: null,
      now: new Date(),
    });
  }
}

async function sweepFromCheckpoint(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
): Promise<{ head: number; checkpoint: number; missedLogs: number }> {
  const head = await readHead(send);
  const cursor = await input.repo.chainCheckpoint(BSC_CHAIN);
  const checkpoint = cursor?.blockNumber ?? head;
  if (cursor === null || head < checkpoint) return { head, checkpoint, missedLogs: 0 };
  const missedLogs = await catchUpBscLogs(input, send, checkpoint, head, cursor.coverageBlock);
  input.logger.info({ fromBlock: checkpoint, toBlock: head, missedLogs }, "bsc log sweep stored");
  return { head, checkpoint, missedLogs };
}

/** Startup catch-up and the 3-minute sweep. The checkpoint is the block last queried. */
export async function catchUpBscLogs(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
  fromBlock: number,
  toBlock: number,
  coverageBlock: number | null,
): Promise<number> {
  const pages = await servedLogPages(input.logger, send, fromBlock, toBlock);
  let missed = 0;
  for (const page of pages) {
    for (const item of page.logs) {
      const log = parseLog(item);
      if (!log) continue;
      const outcome = await handlePortalLog(input.repo, log, (token) => enrich(send, token));
      if (outcome.stored) missed += 1;
      if (outcome.needsEnrich && outcome.token) await scheduleEnrich(input.repo, outcome.token, 0);
    }
    await input.repo.saveChainCheckpoint({
      chain: BSC_CHAIN,
      blockNumber: page.toBlock,
      coverageBlock,
      now: new Date(),
    });
    input.logger.info(
      { fromBlock: page.fromBlock, toBlock: page.toBlock, logs: page.logs.length },
      "bsc catch-up page stored",
    );
  }
  return missed;
}

interface ServedLogPage {
  fromBlock: number;
  toBlock: number;
  logs: unknown[];
}

/**
 * Pages stop at the head the node just reported. The next page starts at that
 * block, so a lagging node cannot move the cursor past logs it did not return.
 */
async function servedLogPages(
  logger: Logger,
  send: (method: string, params: unknown[]) => Promise<unknown>,
  fromBlock: number,
  toBlock: number,
): Promise<ServedLogPage[]> {
  const pages: ServedLogPage[] = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const plannedTo = Math.min(toBlock, from + LOG_PAGE_BLOCKS - 1);
    const page = await getLogsWithRetry(logger, send, from, plannedTo);
    if (!page) break;
    pages.push(page);
    if (page.toBlock < plannedTo || page.toBlock >= toBlock) break;
    from = page.toBlock;
  }
  return pages;
}

async function getLogsWithRetry(
  logger: Logger,
  send: (method: string, params: unknown[]) => Promise<unknown>,
  fromBlock: number,
  toBlock: number,
): Promise<ServedLogPage | null> {
  let attempt = 1;
  for (;;) {
    const head = await readHead(send);
    const range = clampLogRange(fromBlock, toBlock, head);
    if (!range) return null;
    try {
      const logs = await send("eth_getLogs", [
        {
          address: FLAP_PORTAL,
          fromBlock: `0x${range.fromBlock.toString(16)}`,
          toBlock: `0x${range.toBlock.toString(16)}`,
          topics: [[...FLAP_LOG_TOPICS]],
        },
      ]);
      if (!Array.isArray(logs)) throw new Error("bsc eth_getLogs returned no list");
      return { logs, fromBlock: range.fromBlock, toBlock: range.toBlock };
    } catch (error) {
      logger.warn({ err: error, fromBlock, toBlock, attempt }, "bsc eth_getLogs failed");
      if (attempt >= 5) throw error;
      await delay(backoffDelayMs(attempt, () => 0));
      attempt += 1;
    }
  }
}

/** Six-hour recall. The audited window ends at the last block the node served. */
export async function auditBscLogs(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
): Promise<void> {
  const head = await readHead(send);
  const cursor = await input.repo.chainCheckpoint(BSC_CHAIN);
  const coverage = cursor?.coverageBlock ?? null;
  if (coverage === null) return;
  const plannedTo = Math.max(coverage, head - AUDIT_QUIET_BLOCKS);
  const fromBlock = Math.max(coverage, plannedTo - AUDIT_HOUR_BLOCKS);
  if (plannedTo < fromBlock) return;
  const pages = await servedLogPages(input.logger, send, fromBlock, plannedTo);
  const servedTo = pages[pages.length - 1]?.toBlock;
  if (servedTo === undefined) return;
  let matched = 0;
  let missed = 0;
  for (const page of pages) {
    const known = await input.repo.chainEventKeys(BSC_CHAIN, page.fromBlock, page.toBlock);
    for (const item of page.logs) {
      const log = parseLog(item);
      if (!log) continue;
      const key = `${log.txHash}:${log.logIndex.toString()}`;
      if (known.has(key)) matched += 1;
      else {
        missed += 1;
        const outcome = await handlePortalLog(input.repo, log, (token) => enrich(send, token));
        if (outcome.needsEnrich && outcome.token)
          await scheduleEnrich(input.repo, outcome.token, 0);
      }
    }
  }
  await input.repo.insertChainAudit({
    chain: BSC_CHAIN,
    ranAt: new Date(),
    fromBlock,
    toBlock: servedTo,
    expected: matched + missed,
    matched,
    missed,
  });
  input.logger.info(
    { chain: BSC_CHAIN, fromBlock, toBlock: servedTo, expected: matched + missed, matched, missed },
    "bsc recall window",
  );
}

async function retryEnrichments(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
): Promise<void> {
  const due = await input.repo.dueAssetEnrich(new Date());
  for (const row of due) {
    const state = await enrich(send, row.address).catch(() => null);
    if (!enrichmentMissing(state) && state) {
      await input.repo.rememberAsset({
        chain: row.chain,
        address: row.address,
        launchpad: FLAP_LAUNCHPAD,
        quoteAddress: state.quoteToken,
        taxBps: Math.max(state.buyTaxBps, state.sellTaxBps),
        buyTaxBps: state.buyTaxBps,
        sellTaxBps: state.sellTaxBps,
        pool: state.pool !== ZERO_ADDRESS ? state.pool : null,
        clPoolId: null,
        creator: null,
        createdBlock: null,
        createdAt: new Date(),
        txHash: "enrich",
      });
      await input.repo.clearAssetEnrich(row.chain, row.address);
      continue;
    }
    const delayMs = enrichRetryDelayMs(row.attempt + 1);
    if (delayMs === null) {
      await input.repo.clearAssetEnrich(row.chain, row.address);
      input.logger.info({ token: row.address }, "bsc enrich retries exhausted");
      continue;
    }
    await scheduleEnrich(input.repo, row.address, row.attempt + 1);
  }
}

async function scheduleEnrich(
  repo: IngestRepository,
  token: string,
  attempt: number,
): Promise<void> {
  const delayMs = enrichRetryDelayMs(attempt);
  if (delayMs === null) return;
  await repo.scheduleAssetEnrich({
    chain: BSC_CHAIN,
    address: token,
    attempt,
    dueAt: new Date(Date.now() + delayMs),
  });
}

function enrichmentMissing(state: FlapTokenState | null): boolean {
  return state === null || state.status === 0;
}

async function readHead(
  send: (method: string, params: unknown[]) => Promise<unknown>,
): Promise<number> {
  const headHex = await send("eth_blockNumber", []);
  const head = typeof headHex === "string" ? Number.parseInt(headHex, 16) : Number.NaN;
  if (!Number.isFinite(head)) throw new Error("bsc eth_blockNumber failed");
  return head;
}

async function enrich(
  send: (method: string, params: unknown[]) => Promise<unknown>,
  token: string,
): Promise<FlapTokenState | null> {
  const result = await send("eth_call", [
    { to: FLAP_PORTAL, data: encodeGetTokenV8Safe(token) },
    "latest",
  ]);
  if (typeof result !== "string") return null;
  return decodeTokenStateV8(result);
}

function parseLog(value: unknown): PortalLog | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const topics = Array.isArray(record["topics"])
    ? record["topics"].filter((topic): topic is string => typeof topic === "string")
    : [];
  const data = typeof record["data"] === "string" ? record["data"] : "0x";
  const blockNumber =
    typeof record["blockNumber"] === "string" ? Number.parseInt(record["blockNumber"], 16) : null;
  const txHash = typeof record["transactionHash"] === "string" ? record["transactionHash"] : null;
  const logIndex =
    typeof record["logIndex"] === "string" ? Number.parseInt(record["logIndex"], 16) : null;
  if (
    blockNumber === null ||
    txHash === null ||
    logIndex === null ||
    !Number.isFinite(blockNumber)
  ) {
    return null;
  }
  return { topics, data, blockNumber, txHash, logIndex };
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
