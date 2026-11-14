import { decodeBase58 } from "./base58.js";
import { reader, readPubkey, readU16 } from "./borsh.js";
import {
  ANCHOR_EVENT_DISC,
  DAMM_V2_PROGRAM_ID,
  DBC_PROGRAM_ID,
  DISC,
  DLMM_PROGRAM_ID,
  INSTRUCTION_LAYOUTS,
  QUOTE_MINTS,
  SWAP_LAYOUTS,
  WATCHED_PROGRAMS,
  sameDisc,
  type EventKind,
  type InstructionLayout,
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

export interface DecodeFailure {
  signature: string;
  slot: number;
  programId: string;
  instructionName: string | null;
  error: string;
}

/** Map IDL account names onto the instruction's account list, in IDL order. */
export function accountsByName(
  names: readonly string[],
  accounts: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const limit = Math.min(names.length, accounts.length);
  for (let index = 0; index < limit; index += 1) {
    const name = names[index];
    const value = accounts[index];
    if (!name || !value) continue;
    out.set(name, value);
  }
  return out;
}

export interface PoolMint {
  pool: string;
  mint: string;
}

/**
 * EvtCurveComplete carries the pool and not the mint. The swap in the same
 * transaction names base_mint, and an initialize in the same transaction does too.
 */
export function applyCurveMints(
  observations: readonly Observation[],
  swaps: readonly PoolMint[],
): Observation[] {
  const mints = new Map<string, string>();
  for (const observation of observations) {
    if (observation.kind === "dbc_initialize" && observation.pool && observation.mint) {
      mints.set(observation.pool, observation.mint);
    }
  }
  for (const swap of swaps) mints.set(swap.pool, swap.mint);
  return observations.map((observation) => {
    if (observation.kind !== "dbc_curve_complete" || observation.mint !== null) return observation;
    if (observation.pool === null) return observation;
    const mint = mints.get(observation.pool);
    return mint === undefined ? observation : { ...observation, mint };
  });
}

export function parseSlotNotification(message: unknown): number | null {
  if (!isRecord(message) || message["method"] !== "slotNotification") return null;
  const result = asRecord(asRecord(message["params"])?.["result"]);
  return typeof result?.["slot"] === "number" ? result["slot"] : null;
}

/** Response to a getSlot request sent on the same WebSocket. The matching id is the pong. */
export function parseSlotResponse(message: unknown, id: number): number | null {
  if (!isRecord(message) || message["id"] !== id) return null;
  return typeof message["result"] === "number" ? message["result"] : null;
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
  return { observations, failures: [], byteLength: receivedBytes, signature, slot };
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
    failures: [],
    byteLength: receivedBytes,
    signature,
    slot,
  };
}

export function parseParsedNotification(
  message: unknown,
  receivedBytes: number,
): ParsedFrame | null {
  if (!isRecord(message) || message["method"] !== "parsedTransactionNotification") return null;
  const result = asRecord(asRecord(message["params"])?.["result"]);
  const value = asRecord(result?.["value"]);
  const transaction = asRecord(value?.["transaction"]);
  const context = asRecord(result?.["context"]);
  const signature =
    typeof transaction?.["signature"] === "string" ? transaction["signature"] : null;
  const slot =
    typeof transaction?.["slot"] === "number"
      ? transaction["slot"]
      : typeof context?.["slot"] === "number"
        ? context["slot"]
        : null;
  if (signature === null || slot === null) return null;
  if (transaction?.["error"] != null) return null;
  const blockTime =
    typeof transaction?.["blockTime"] === "number" ? transaction["blockTime"] * 1000 : null;
  const instructions = Array.isArray(value?.["instructions"]) ? value["instructions"] : [];
  const found: Observation[] = [];
  const failures: DecodeFailure[] = [];
  for (const instruction of instructions) {
    const record = asRecord(instruction);
    if (record === null || typeof record["instructionName"] !== "string") continue;
    const instructionName = record["instructionName"];
    const kind = kindFromInstructionName(instructionName);
    if (kind === null) continue;
    const programId = typeof record["programId"] === "string" ? record["programId"] : "";
    const named = namedAccounts(asRecord(record["decoded"]));
    const rawAccounts = accountPubkeys({ accounts: record["rawAccounts"] }, []);
    const built = observationFromParsedAccounts({
      kind,
      programId,
      named,
      rawAccounts,
      signature,
      slot,
      blockTimeMs: blockTime,
      eventIndex: found.length,
    });
    if (built) {
      found.push(built);
      continue;
    }
    failures.push({
      signature,
      slot,
      programId,
      instructionName,
      error: "named accounts did not include a pool and mint",
    });
  }
  const observations = dedupeObservations(found);
  if (observations.length === 0 && failures.length === 0) return null;
  return { observations, failures, byteLength: receivedBytes, signature, slot };
}

export interface ParsedFrame {
  observations: Observation[];
  failures: DecodeFailure[];
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
    if (/^Program log: Instruction: /.test(line)) continue;
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
  return preferDetailed(found).filter(isPersistable);
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

export function isPersistable(observation: Observation): boolean {
  if (observation.pool === null) return false;
  if (observation.kind === "dbc_curve_complete") return true;
  return observation.mint !== null;
}

export function normalizeInstructionName(name: string): string {
  return name.toLowerCase().replaceAll("_", "").replaceAll(" ", "");
}

function kindFromInstructionName(name: string): EventKind | null {
  const normalized = normalizeInstructionName(name);
  if (normalized.includes("initializevirtualpool")) return "dbc_initialize";
  if (normalized === "migrationdammv2") return "dbc_migration_damm_v2";
  if (
    normalized.startsWith("initializecustomizablepool") ||
    normalized.startsWith("initializepool")
  ) {
    return "damm_v2_initialize";
  }
  if (normalized.startsWith("initializelbpair") || normalized.includes("permissionlesslbpair")) {
    return "dlmm_initialize";
  }
  return null;
}

export function parseRpcTransaction(result: unknown, signature: string): Observation[] {
  return decodeRpcTransaction(result, signature).observations;
}

export function decodeRpcTransaction(
  result: unknown,
  signature: string,
): { observations: Observation[]; failures: DecodeFailure[] } {
  const record = asRecord(result);
  if (record === null || record["meta"] == null) return { observations: [], failures: [] };
  const meta = asRecord(record["meta"]);
  if (meta?.["err"] != null) return { observations: [], failures: [] };
  const slot = typeof record["slot"] === "number" ? record["slot"] : 0;
  const blockTimeMs = typeof record["blockTime"] === "number" ? record["blockTime"] * 1000 : null;
  const logs = Array.isArray(meta?.["logMessages"])
    ? meta["logMessages"].filter((line): line is string => typeof line === "string")
    : [];
  const fromLogs = observationsFromLogs({ signature, slot, logs, blockTimeMs });
  const transaction = asRecord(record["transaction"]);
  const walked = walkInstructions({
    signature,
    slot,
    blockTimeMs,
    startIndex: fromLogs.length,
    transaction: {
      message: asRecord(transaction?.["message"]) ?? {},
      meta: meta ?? {},
    },
  });
  return {
    observations: dedupeObservations(
      applyCurveMints([...fromLogs, ...walked.observations], walked.swaps),
    ),
    failures: walked.failures,
  };
}

function observationFromParsedAccounts(input: {
  kind: EventKind;
  programId: string;
  named: Map<string, string>;
  rawAccounts: string[];
  signature: string;
  slot: number;
  blockTimeMs: number | null;
  eventIndex: number;
}): Observation | null {
  const poolType: PoolType =
    input.kind === "dbc_initialize" || input.kind === "dbc_curve_complete"
      ? "dbc"
      : input.kind === "dlmm_initialize"
        ? "dlmm"
        : "damm_v2";
  const pick = (...names: string[]): string | null => {
    for (const name of names) {
      const value = input.named.get(normalizeInstructionName(name));
      if (value) return value;
    }
    return null;
  };
  let mint = pick("base_mint");
  const pool = pick("pool", "lb_pair");
  const mintA = pick("token_a_mint", "token_mint_x", "token_x");
  const mintB = pick("token_b_mint", "token_mint_y", "token_y");
  if (mint === null && mintA !== null) {
    mint = mintB === null ? mintA : chooseTokenMint(mintA, mintB);
  }
  const creator = pick("creator", "funder", "payer");
  const virtualPool = pick("virtual_pool");
  const quoteMint = pick("quote_mint");
  if ((mint === null || pool === null) && input.rawAccounts.length > 0) {
    const layout = INSTRUCTION_LAYOUTS.find(
      (entry) => entry.layout.kind === input.kind && entry.programId === input.programId,
    );
    if (layout) {
      const fromRaw = observationFromLayout(
        {
          ...input,
          programId: input.programId,
          accounts: input.rawAccounts,
          failures: [],
        },
        layout.layout,
      );
      if (fromRaw && isPersistable(fromRaw)) return fromRaw;
    }
  }
  const observation: Observation = {
    ...blankObservation(input, input.kind, poolType, input.programId, input.eventIndex),
    mint,
    pool,
    creatorWallet: creator,
    virtualPool,
    quoteMint,
  };
  return isPersistable(observation) ? observation : null;
}

function namedAccounts(decoded: Record<string, unknown> | null): Map<string, string> {
  const out = new Map<string, string>();
  const accounts = decoded?.["accounts"];
  if (!Array.isArray(accounts)) return out;
  for (const account of accounts) {
    const record = asRecord(account);
    if (record && typeof record["name"] === "string" && typeof record["pubkey"] === "string") {
      out.set(normalizeInstructionName(record["name"]), record["pubkey"]);
    }
  }
  return out;
}

export function observationsFromTransaction(input: {
  signature: string;
  slot: number;
  transaction: Record<string, unknown> | null;
  blockTimeMs: number | null;
  startIndex: number;
}): Observation[] {
  const walked = walkInstructions(input);
  return applyCurveMints(walked.observations, walked.swaps);
}

function walkInstructions(input: {
  signature: string;
  slot: number;
  transaction: Record<string, unknown> | null;
  blockTimeMs: number | null;
  startIndex: number;
}): { observations: Observation[]; failures: DecodeFailure[]; swaps: PoolMint[] } {
  if (input.transaction === null) return { observations: [], failures: [], swaps: [] };
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
  const failures: DecodeFailure[] = [];
  const swaps: PoolMint[] = [];
  for (const instruction of instructions) {
    const record = asRecord(instruction);
    if (record === null) continue;
    const programId = programIdOf(record, keys);
    const data = typeof record["data"] === "string" ? record["data"] : "";
    let raw: Uint8Array;
    try {
      raw = data.length > 0 ? decodeBase58(data) : new Uint8Array();
    } catch (error) {
      if (programId !== null && (WATCHED_PROGRAMS as readonly string[]).includes(programId)) {
        failures.push({
          signature: input.signature,
          slot: input.slot,
          programId,
          instructionName: null,
          error: error instanceof Error ? error.message : "instruction data was not base58",
        });
      }
      continue;
    }
    const accounts = accountPubkeys(record, keys);
    const swap = swapMint(programId, raw, accounts);
    if (swap) swaps.push(swap);
    const built = observationFromInstruction({
      programId,
      data: raw,
      accounts,
      signature: input.signature,
      slot: input.slot,
      blockTimeMs: input.blockTimeMs,
      eventIndex: input.startIndex + found.length,
      failures,
    });
    if (built) found.push(built);
  }
  return { observations: found, failures, swaps };
}

function swapMint(programId: string | null, data: Uint8Array, accounts: string[]): PoolMint | null {
  if (programId === null || data.length < 8) return null;
  const match = SWAP_LAYOUTS.find(
    (entry) => entry.programId === programId && sameDisc(data, entry.disc),
  );
  if (!match) return null;
  const named = accountsByName(match.accountNames, accounts);
  const pool = named.get("pool");
  const mint = named.get("base_mint");
  if (!pool || !mint) return null;
  return { pool, mint };
}

function observationFromInstruction(input: {
  programId: string | null;
  data: Uint8Array;
  accounts: string[];
  signature: string;
  slot: number;
  blockTimeMs: number | null;
  eventIndex: number;
  failures: DecodeFailure[];
}): Observation | null {
  const programId = input.programId;
  if (programId === null || input.data.length < 8) return null;
  if (sameDisc(input.data, ANCHOR_EVENT_DISC) && input.data.length >= 16) {
    const decoded = decodeProgramData(
      programId,
      Buffer.from(input.data.subarray(8)).toString("base64"),
    );
    if (!decoded) return null;
    return {
      ...blankObservation(input, decoded.kind, decoded.poolType, programId, input.eventIndex),
      mint: decoded.mint,
      pool: decoded.pool,
      creatorWallet: decoded.creatorWallet,
      virtualPool: decoded.virtualPool,
      quoteMint: decoded.quoteMint,
    };
  }
  const match = INSTRUCTION_LAYOUTS.find(
    (entry) => entry.programId === programId && sameDisc(input.data, entry.disc),
  );
  if (!match) return null;
  return observationFromLayout({ ...input, programId }, match.layout);
}

function observationFromLayout(
  input: {
    programId: string;
    accounts: string[];
    signature: string;
    slot: number;
    blockTimeMs: number | null;
    eventIndex: number;
    failures: DecodeFailure[];
  },
  layout: InstructionLayout,
): Observation | null {
  const named = accountsByName(layout.accountNames, input.accounts);
  const mintA = named.get(layout.mintA) ?? null;
  const mintB = layout.mintB === null ? null : (named.get(layout.mintB) ?? null);
  const mint = mintA === null ? null : mintB === null ? mintA : chooseTokenMint(mintA, mintB);
  const pool = named.get(layout.pool) ?? null;
  if (pool === null || mint === null) {
    const missing = pool === null ? layout.pool : layout.mintA;
    input.failures.push({
      signature: input.signature,
      slot: input.slot,
      programId: input.programId,
      instructionName: layout.instructionName,
      error: `missing account ${missing}`,
    });
    return null;
  }
  return {
    ...blankObservation(input, layout.kind, layout.poolType, input.programId, input.eventIndex),
    mint,
    pool,
    creatorWallet: layout.creator === null ? null : (named.get(layout.creator) ?? null),
    virtualPool: layout.virtualPool === null ? null : (named.get(layout.virtualPool) ?? null),
    quoteMint: layout.quoteMint === null ? null : (named.get(layout.quoteMint) ?? null),
  };
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

function accountPubkeys(instruction: Record<string, unknown>, keys: string[]): string[] {
  const accounts = instruction["accounts"];
  if (!Array.isArray(accounts)) return [];
  return accounts
    .map((account) => {
      if (typeof account === "number") return keys[account] ?? null;
      if (typeof account === "string") return account;
      const record = asRecord(account);
      return typeof record?.["pubkey"] === "string" ? record["pubkey"] : null;
    })
    .filter((account): account is string => account !== null);
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
    if (!isPersistable(observation)) continue;
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

export interface CanonicalEvent {
  signature: string;
  slot: number;
  programId: string;
  kind: EventKind;
  poolType: PoolType;
  mint: string | null;
  pool: string | null;
  creatorWallet: string | null;
  virtualPool: string | null;
  quoteMint: string | null;
}

export function canonicalEvents(observations: readonly Observation[]): CanonicalEvent[] {
  return observations.map((observation) => ({
    signature: observation.signature,
    slot: observation.slot,
    programId: observation.programId,
    kind: observation.kind,
    poolType: observation.poolType,
    mint: observation.mint,
    pool: observation.pool,
    creatorWallet: observation.creatorWallet,
    virtualPool: observation.virtualPool,
    quoteMint: observation.quoteMint,
  }));
}

/**
 * Turn a getTransaction result into the parsed-stream notification shape.
 * Named accounts follow the same IDL lists the instruction decoder uses.
 */
export function normalizeRpcToParsedNotification(result: unknown, signature: string): unknown {
  const record = asRecord(result);
  const meta = asRecord(record?.["meta"]);
  const slot = typeof record?.["slot"] === "number" ? record["slot"] : 0;
  const blockTime = typeof record?.["blockTime"] === "number" ? record["blockTime"] : null;
  const transaction = asRecord(record?.["transaction"]);
  const message = asRecord(transaction?.["message"]);
  const keys = accountKeys(message, meta);
  const rawInstructions = Array.isArray(message?.["instructions"]) ? message["instructions"] : [];
  const instructions = [];
  for (const instruction of rawInstructions) {
    const row = asRecord(instruction);
    if (row === null) continue;
    const programId = programIdOf(row, keys);
    const data = typeof row["data"] === "string" ? row["data"] : "";
    let bytes: Uint8Array;
    try {
      bytes = data.length > 0 ? decodeBase58(data) : new Uint8Array();
    } catch {
      continue;
    }
    if (programId === null || bytes.length < 8) continue;
    const match = INSTRUCTION_LAYOUTS.find(
      (entry) => entry.programId === programId && sameDisc(bytes, entry.disc),
    );
    if (!match) continue;
    const accounts = accountPubkeys(row, keys);
    instructions.push({
      programId,
      instructionName: match.layout.instructionName,
      decoded: {
        accounts: match.layout.accountNames
          .map((name, index) => {
            const pubkey = accounts[index];
            return pubkey ? { name, pubkey } : null;
          })
          .filter((account): account is { name: string; pubkey: string } => account !== null),
      },
    });
  }
  return {
    jsonrpc: "2.0",
    method: "parsedTransactionNotification",
    params: {
      result: {
        context: { slot },
        value: {
          transaction: { signature, slot, error: null, blockTime },
          instructions,
        },
      },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
