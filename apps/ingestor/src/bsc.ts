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

/** One getLogs page. Alchemy's free-tier eth_getLogs range stays small. */
const MAX_CATCHUP_BLOCKS = 500;
/** About 90 seconds of BSC blocks, ending this far behind the tip. */
const AUDIT_SPAN_BLOCKS = 200;
const AUDIT_QUIET_BLOCKS = 200;
const AUDIT_EVERY_MS = 6 * 60 * 60 * 1000;

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
  while (!input.signal.aborted) {
    try {
      await connectBsc(input);
      attempt = 1;
    } catch (error) {
      if (input.signal.aborted) return;
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
): Promise<void> {
  const topic = log.topics[0];
  if (!topic) return;
  const event = decodePortalLog(topic, log.data);
  if (!event) return;
  const createdAt = new Date();
  if (event.kind === "create") {
    const state = await enrich(event.token).catch(() => null);
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
  await repo.insertChainEvent({
    chain: BSC_CHAIN,
    txHash: log.txHash,
    logIndex: log.logIndex,
    blockNumber: log.blockNumber,
    eventName: event.kind,
    address: event.token,
  });
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
  const pending = new Map<number, (value: unknown) => void>();
  let nextId = 1;
  const send = (method: string, params: unknown[]): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(id)) return;
        reject(new Error("bsc rpc timed out"));
      }, 20_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return result;
  };
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", () => reject(new Error("bsc websocket failed to open")));
  });
  const onMessage = (raw: WebSocket.RawData): void => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message["id"] === "number") {
      const resolve = pending.get(message["id"]);
      if (!resolve) return;
      pending.delete(message["id"]);
      if (message["error"]) {
        resolve(null);
        return;
      }
      resolve(message["result"]);
      return;
    }
    if (message["method"] !== "eth_subscription") return;
    const params = message["params"];
    if (!params || typeof params !== "object") return;
    const result = (params as { result?: unknown }).result;
    const log = parseLog(result);
    if (!log) return;
    void handlePortalLog(input.repo, log, (token) => enrich(send, token))
      .then(() =>
        input.repo.saveChainCheckpoint({
          chain: BSC_CHAIN,
          blockNumber: log.blockNumber,
          coverageBlock: null,
          now: new Date(),
        }),
      )
      .catch((error: unknown) => {
        input.logger.error({ err: error }, "bsc log failed");
      });
  };
  ws.on("message", onMessage);
  try {
    const headHex = await send("eth_blockNumber", []);
    const head = typeof headHex === "string" ? Number.parseInt(headHex, 16) : null;
    if (head === null || !Number.isFinite(head)) throw new Error("bsc eth_blockNumber failed");
    const cursor = await input.repo.chainCheckpoint(BSC_CHAIN);
    if (cursor === null) {
      await input.repo.saveChainCheckpoint({
        chain: BSC_CHAIN,
        blockNumber: head,
        coverageBlock: head,
        now: new Date(),
      });
      input.logger.info({ chain: BSC_CHAIN, block: head }, "bsc coverage starts at the tip");
    } else if (head > cursor.blockNumber && head - cursor.blockNumber <= MAX_CATCHUP_BLOCKS) {
      await catchUp(input, send, cursor.blockNumber + 1, head);
    } else if (head - cursor.blockNumber > MAX_CATCHUP_BLOCKS) {
      input.logger.warn(
        { fromBlock: cursor.blockNumber, toBlock: head },
        "bsc gap is wider than the catch-up cap",
      );
      await input.repo.saveChainCheckpoint({
        chain: BSC_CHAIN,
        blockNumber: head,
        coverageBlock: null,
        now: new Date(),
      });
    }
    await send("eth_subscribe", ["logs", portalLogFilter()]);
    input.logger.info({ chain: BSC_CHAIN, portal: FLAP_PORTAL }, "bsc flap subscription started");
    const audit = setInterval(() => {
      void recallBsc(input, send, head).catch((error: unknown) => {
        input.logger.error({ err: error }, "bsc recall failed");
      });
    }, AUDIT_EVERY_MS);
    await new Promise<void>((resolve) => {
      const finish = () => resolve();
      ws.once("close", finish);
      input.signal.addEventListener("abort", () => ws.close(), { once: true });
    });
    clearInterval(audit);
  } finally {
    ws.off("message", onMessage);
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
}

async function catchUp(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
  fromBlock: number,
  toBlock: number,
): Promise<void> {
  const logs = await send("eth_getLogs", [
    {
      address: FLAP_PORTAL,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [[...FLAP_LOG_TOPICS]],
    },
  ]);
  if (!Array.isArray(logs)) return;
  for (const item of logs) {
    const log = parseLog(item);
    if (!log) continue;
    await handlePortalLog(input.repo, log, (token) => enrich(send, token));
  }
  await input.repo.saveChainCheckpoint({
    chain: BSC_CHAIN,
    blockNumber: toBlock,
    coverageBlock: null,
    now: new Date(),
  });
  input.logger.info({ fromBlock, toBlock, logs: logs.length }, "bsc catch-up stored");
}

async function recallBsc(
  input: { repo: IngestRepository; logger: Logger },
  send: (method: string, params: unknown[]) => Promise<unknown>,
  headHint: number,
): Promise<void> {
  const headHex = await send("eth_blockNumber", []);
  const head = typeof headHex === "string" ? Number.parseInt(headHex, 16) : headHint;
  const cursor = await input.repo.chainCheckpoint(BSC_CHAIN);
  const coverage = cursor?.coverageBlock ?? null;
  if (coverage === null) return;
  const toBlock = head - AUDIT_QUIET_BLOCKS;
  const fromBlock = toBlock - AUDIT_SPAN_BLOCKS;
  if (fromBlock < coverage) return;
  const logs = await send("eth_getLogs", [
    {
      address: FLAP_PORTAL,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [[...FLAP_LOG_TOPICS]],
    },
  ]);
  if (!Array.isArray(logs)) return;
  const known = await input.repo.chainEventKeys(BSC_CHAIN, fromBlock, toBlock);
  let matched = 0;
  let missed = 0;
  for (const item of logs) {
    const log = parseLog(item);
    if (!log) continue;
    const key = `${log.txHash}:${log.logIndex.toString()}`;
    if (known.has(key)) matched += 1;
    else missed += 1;
  }
  await input.repo.insertChainAudit({
    chain: BSC_CHAIN,
    ranAt: new Date(),
    fromBlock,
    toBlock,
    expected: matched + missed,
    matched,
    missed,
  });
  input.logger.info({ fromBlock, toBlock, matched, missed }, "bsc recall window");
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
