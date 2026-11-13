import { decodeBase58 } from "./base58.js";
import { reader, readPubkey, readU16 } from "./borsh.js";
import {
  DAMM_V2_PROGRAM_ID,
  DBC_PROGRAM_ID,
  DISC,
  DLMM_PROGRAM_ID,
  MIGRATION_DAMM_V2_ACCOUNTS,
  QUOTE_MINTS,
  sameDisc,
  type EventKind,
  type PoolType,
} from "./programs.js";

export interface Observation {
  signature: string;
  slot: number;
  programId: string;
  eventIndex: number;
  kind: EventKind;
  poolType: PoolType;
  mint: string | null;
  pool: string | null;
  creatorWallet: string | null;
  virtualPool: string | null;
  quoteMint: string | null;
  blockTimeMs: number | null;
}

export function chooseTokenMint(left: string, right: string): string {
  const leftQuote = QUOTE_MINTS.has(left);
  const rightQuote = QUOTE_MINTS.has(right);
  if (leftQuote && !rightQuote) return right;
  if (rightQuote && !leftQuote) return left;
  return left;
}

export function parseLogsNotification(message: unknown, receivedBytes: number): ParsedFrame | null {
  if (!isRecord(message) || message["method"] !== "logsNotification") return null;
  const params = asRecord(message["params"]);
  const result = asRecord(params?.["result"]);
  const context = asRecord(result?.["context"]);
  const value = asRecord(result?.["value"]);
  const slot = context?.["slot"];
  const signature = value?.["signature"];
  const logs = value?.["logs"];
  if (typeof slot !== "number" || typeof signature !== "string" || !Array.isArray(logs))
    return null;
  if (value?.["err"] != null) return null;
  const observations = observationsFromLogs({
    signature,
    slot,
    logs: logs.filter((line): line is string => typeof line === "string"),
    blockTimeMs: null,
  });
  return { observations, byteLength: receivedBytes, signature, slot };
}

export function parseTransactionNotification(
  message: unknown,
  receivedBytes: number,
): ParsedFrame | null {
  if (!isRecord(message) || message["method"] !== "transactionNotification") return null;
  const params = asRecord(message["params"]);
  const result = asRecord(params?.["result"]);
  if (result === null) return null;
  const signature = typeof result["signature"] === "string" ? result["signature"] : null;
  const slot = typeof result["slot"] === "number" ? result["slot"] : null;
  if (signature === null || slot === null) return null;
  const transaction = asRecord(result["transaction"]);
  const meta =
    asRecord(transaction?.["meta"]) ?? asRecord(asRecord(transaction?.["transaction"])?.["meta"]);
  const logs = Array.isArray(meta?.["logMessages"])
    ? meta["logMessages"].filter((line): line is string => typeof line === "string")
    : [];
  const err = meta?.["err"] ?? result["err"] ?? null;
  if (err != null) return null;
  const blockTime = typeof result["blockTime"] === "number" ? result["blockTime"] * 1000 : null;
  const fromLogs = observationsFromLogs({ signature, slot, logs, blockTimeMs: blockTime });
  const fromIxs = observationsFromTransaction({
    signature,
    slot,
    transaction,
    blockTimeMs: blockTime,
    startIndex: fromLogs.length,
  });
  return {
    observations: dedupeObservations([...fromLogs, ...fromIxs]),
    byteLength: receivedBytes,
    signature,
    slot,
  };
}

export interface ParsedFrame {
  observations: Observation[];
  byteLength: number;
  signature: string;
  slot: number;
}

export function observationsFromLogs(input: {
  signature: string;
  slot: number;
  logs: readonly string[];
  blockTimeMs: number | null;
}): Observation[] {
  const found: Observation[] = [];
  const stack: string[] = [];
  for (const line of input.logs) {
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke/.exec(line);
    if (invoke?.[1]) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program [1-9A-HJ-NP-Za-km-z]{32,44} (success|consumed|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    const instruction = /^Program log: Instruction: (.+)$/.exec(line);
    if (instruction?.[1]) {
      const kind = kindFromInstructionName(instruction[1], stack.at(-1) ?? "");
      if (kind) {
        found.push(blankObservation(input, kind.kind, kind.poolType, kind.programId, found.length));
      }
      continue;
    }
    const data = /^Program data: ([A-Za-z0-9+/=]+)$/.exec(line);
    if (!data?.[1]) continue;
    const programId = stack.at(-1);
    if (!programId) continue;
    const decoded = decodeProgramData(programId, data[1]);
    if (!decoded) continue;
    found.push({
      ...blankObservation(input, decoded.kind, decoded.poolType, programId, found.length),
      mint: decoded.mint,
      pool: decoded.pool,
      creatorWallet: decoded.creatorWallet,
      virtualPool: decoded.virtualPool,
      quoteMint: decoded.quoteMint,
    });
  }
  return preferDetailed(found);
}

export function decodeProgramData(
  programId: string,
  base64: string,
): Omit<Observation, "signature" | "slot" | "eventIndex" | "blockTimeMs" | "programId"> | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return null;
  }
  if (bytes.length < 8) return null;
  const cursor = reader(bytes, 8);
  if (
    programId === DBC_PROGRAM_ID &&
    (sameDisc(bytes, DISC.dbcInitializePool) || sameDisc(bytes, DISC.dbcInitializePoolHook))
  ) {
    const pool = readPubkey(cursor);
    readPubkey(cursor);
    const creator = readPubkey(cursor);
    const mint = readPubkey(cursor);
    if (!pool || !mint) return null;
    return eventBody("dbc_initialize", "dbc", mint, pool, creator, null, null);
  }
  if (
    programId === DBC_PROGRAM_ID &&
    (sameDisc(bytes, DISC.dbcCurveComplete) || sameDisc(bytes, DISC.dbcCurveCompleteHook))
  ) {
    const pool = readPubkey(cursor);
    if (!pool) return null;
    return eventBody("dbc_curve_complete", "dbc", null, pool, null, pool, null);
  }
  if (programId === DAMM_V2_PROGRAM_ID && sameDisc(bytes, DISC.dammInitializePool)) {
    const pool = readPubkey(cursor);
    const tokenA = readPubkey(cursor);
    const tokenB = readPubkey(cursor);
    const creator = readPubkey(cursor);
    if (!pool || !tokenA || !tokenB) return null;
    return eventBody(
      "damm_v2_initialize",
      "damm_v2",
      chooseTokenMint(tokenA, tokenB),
      pool,
      creator,
      null,
      tokenB,
    );
  }
  if (programId === DLMM_PROGRAM_ID && sameDisc(bytes, DISC.dlmmLbPairCreate)) {
    const pool = readPubkey(cursor);
    readU16(cursor);
    const tokenX = readPubkey(cursor);
    const tokenY = readPubkey(cursor);
    if (!pool || !tokenX || !tokenY) return null;
    return eventBody(
      "dlmm_initialize",
      "dlmm",
      chooseTokenMint(tokenX, tokenY),
      pool,
      null,
      null,
      tokenY,
    );
  }
  return null;
}

function eventBody(
  kind: EventKind,
  poolType: PoolType,
  mint: string | null,
  pool: string | null,
  creatorWallet: string | null,
  virtualPool: string | null,
  quoteMint: string | null,
): Omit<Observation, "signature" | "slot" | "eventIndex" | "blockTimeMs" | "programId"> {
  return { kind, poolType, mint, pool, creatorWallet, virtualPool, quoteMint };
}

function kindFromInstructionName(
  name: string,
  programId: string,
): { kind: EventKind; poolType: PoolType; programId: string } | null {
  const normalized = name.toLowerCase().replaceAll("_", "").replaceAll(" ", "");
  if (programId === DBC_PROGRAM_ID) {
    if (normalized.includes("initializevirtualpool")) {
      return { kind: "dbc_initialize", poolType: "dbc", programId };
    }
    if (normalized === "migrationdammv2") {
      return { kind: "dbc_migration_damm_v2", poolType: "damm_v2", programId };
    }
  }
  if (
    programId === DAMM_V2_PROGRAM_ID &&
    (normalized.startsWith("initializepool") || normalized.startsWith("initializecustomizablepool"))
  ) {
    return { kind: "damm_v2_initialize", poolType: "damm_v2", programId };
  }
  if (
    programId === DLMM_PROGRAM_ID &&
    (normalized.startsWith("initializelbpair") || normalized.includes("permissionlesslbpair"))
  ) {
    return { kind: "dlmm_initialize", poolType: "dlmm", programId };
  }
  return null;
}

export function parseRpcTransaction(result: unknown, signature: string): Observation[] {
  const record = asRecord(result);
  if (record === null || record["meta"] == null) return [];
  const meta = asRecord(record["meta"]);
  if (meta?.["err"] != null) return [];
  const slot = typeof record["slot"] === "number" ? record["slot"] : 0;
  const blockTimeMs = typeof record["blockTime"] === "number" ? record["blockTime"] * 1000 : null;
  const logs = Array.isArray(meta?.["logMessages"])
    ? meta["logMessages"].filter((line): line is string => typeof line === "string")
    : [];
  const fromLogs = observationsFromLogs({ signature, slot, logs, blockTimeMs });
  const transaction = asRecord(record["transaction"]);
  const fromInstructions = observationsFromTransaction({
    signature,
    slot,
    blockTimeMs,
    startIndex: fromLogs.length,
    transaction: {
      message: asRecord(transaction?.["message"]) ?? {},
      meta: meta ?? {},
    },
  });
  return dedupeObservations([...fromLogs, ...fromInstructions]);
}

export function observationsFromTransaction(input: {
  signature: string;
  slot: number;
  transaction: Record<string, unknown> | null;
  blockTimeMs: number | null;
  startIndex: number;
}): Observation[] {
  if (input.transaction === null) return [];
  const message =
    asRecord(input.transaction["message"]) ??
    asRecord(asRecord(input.transaction["transaction"])?.["message"]);
  const meta =
    asRecord(input.transaction["meta"]) ??
    asRecord(asRecord(input.transaction["transaction"])?.["meta"]);
  const keys = accountKeys(message, meta);
  const instructions = [
    ...(Array.isArray(message?.["instructions"]) ? message["instructions"] : []),
    ...innerInstructions(meta),
  ];
  const found: Observation[] = [];
  for (const instruction of instructions) {
    const record = asRecord(instruction);
    if (record === null) continue;
    const programId = programIdOf(record, keys);
    const data = typeof record["data"] === "string" ? record["data"] : "";
    let raw: Uint8Array;
    try {
      raw = data.length > 0 ? decodeBase58(data) : new Uint8Array();
    } catch {
      continue;
    }
    const accounts = accountIndexes(record);
    const built = observationFromInstruction({
      programId,
      data: raw,
      accounts,
      keys,
      signature: input.signature,
      slot: input.slot,
      blockTimeMs: input.blockTimeMs,
      eventIndex: input.startIndex + found.length,
    });
    if (built) found.push(built);
  }
  return found;
}

function observationFromInstruction(input: {
  programId: string | null;
  data: Uint8Array;
  accounts: number[];
  keys: string[];
  signature: string;
  slot: number;
  blockTimeMs: number | null;
  eventIndex: number;
}): Observation | null {
  if (input.programId === null || input.data.length < 8) return null;
  const key = (index: number): string | null => {
    const accountIndex = input.accounts[index];
    if (accountIndex === undefined) return null;
    return input.keys[accountIndex] ?? null;
  };
  if (input.programId === DBC_PROGRAM_ID && sameDisc(input.data, DISC.ixMigrationDammV2)) {
    return {
      signature: input.signature,
      slot: input.slot,
      programId: input.programId,
      eventIndex: input.eventIndex,
      kind: "dbc_migration_damm_v2",
      poolType: "damm_v2",
      mint: key(MIGRATION_DAMM_V2_ACCOUNTS.baseMint),
      pool: key(MIGRATION_DAMM_V2_ACCOUNTS.dammPool),
      creatorWallet: key(MIGRATION_DAMM_V2_ACCOUNTS.payer),
      virtualPool: key(MIGRATION_DAMM_V2_ACCOUNTS.virtualPool),
      quoteMint: key(MIGRATION_DAMM_V2_ACCOUNTS.quoteMint),
      blockTimeMs: input.blockTimeMs,
    };
  }
  return null;
}

function accountKeys(
  message: Record<string, unknown> | null,
  meta: Record<string, unknown> | null,
): string[] {
  const raw = message?.["accountKeys"];
  const staticKeys = Array.isArray(raw)
    ? raw
        .map((key) => {
          if (typeof key === "string") return key;
          const record = asRecord(key);
          return typeof record?.["pubkey"] === "string" ? record["pubkey"] : null;
        })
        .filter((key): key is string => key !== null)
    : [];
  const loaded = asRecord(meta?.["loadedAddresses"]);
  const writable = stringList(loaded?.["writable"]);
  const readonly = stringList(loaded?.["readonly"]);
  return [...staticKeys, ...writable, ...readonly];
}

function innerInstructions(meta: Record<string, unknown> | null): unknown[] {
  const groups = meta?.["innerInstructions"];
  if (!Array.isArray(groups)) return [];
  const out: unknown[] = [];
  for (const group of groups) {
    const instructions = asRecord(group)?.["instructions"];
    if (Array.isArray(instructions)) out.push(...instructions);
  }
  return out;
}

function programIdOf(instruction: Record<string, unknown>, keys: string[]): string | null {
  if (typeof instruction["programId"] === "string") return instruction["programId"];
  if (typeof instruction["programIdIndex"] === "number")
    return keys[instruction["programIdIndex"]] ?? null;
  return null;
}

function accountIndexes(instruction: Record<string, unknown>): number[] {
  const accounts = instruction["accounts"];
  if (Array.isArray(accounts) && accounts.every((value) => typeof value === "number")) {
    return accounts;
  }
  return [];
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function blankObservation(
  input: { signature: string; slot: number; blockTimeMs: number | null },
  kind: EventKind,
  poolType: PoolType,
  programId: string,
  eventIndex: number,
): Observation {
  return {
    signature: input.signature,
    slot: input.slot,
    programId,
    eventIndex,
    kind,
    poolType,
    mint: null,
    pool: null,
    creatorWallet: null,
    virtualPool: null,
    quoteMint: null,
    blockTimeMs: input.blockTimeMs,
  };
}

function dedupeObservations(observations: Observation[]): Observation[] {
  const seen = new Set<string>();
  const out: Observation[] = [];
  for (const observation of observations) {
    const key = `${observation.kind}:${observation.pool ?? ""}:${observation.mint ?? ""}:${observation.virtualPool ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...observation, eventIndex: out.length });
  }
  return out;
}

function preferDetailed(observations: Observation[]): Observation[] {
  const detailedKinds = new Set(
    observations
      .filter((observation) => observation.pool !== null)
      .map((observation) => observation.kind),
  );
  return observations
    .filter((observation) => observation.pool !== null || !detailedKinds.has(observation.kind))
    .map((observation, eventIndex) => ({ ...observation, eventIndex }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
