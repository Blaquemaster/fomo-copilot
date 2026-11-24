/**
 * Public-RPC pages for a gap wider than the 600-slot cap. Helius is not used.
 * A finished page walk is only a scan. recovery_completed_at is set only after
 * each transaction has been fetched, decoded, and stored in the event pipeline.
 */
export interface SignatureRow {
  signature: string;
  slot: number | null;
}

export interface RecoveryCheckpoint {
  programId: string;
  fromSlot: number;
  toSlot: number;
  pageBefore: string | null;
  signaturesSeen: number;
  /** The page walk reached the start of the gap. This is not recovery. */
  scanComplete: boolean;
  finished: boolean;
  recoveryCompletedAt: Date | null;
  recordedAt: Date;
}

export async function fetchSignaturePage(input: {
  programId: string;
  before: string | null;
  limit?: number;
  rpcUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<SignatureRow[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params: [string, { limit: number; before?: string }] = [
    input.programId,
    { limit: input.limit ?? 100 },
  ];
  if (input.before) params[1].before = input.before;
  const response = await fetchImpl(input.rpcUrl ?? "https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params,
    }),
  });
  if (!response.ok) throw new Error(`public rpc status ${response.status.toString()}`);
  const body = (await response.json()) as {
    result?: Array<{ signature?: string; slot?: number }>;
  };
  return (body.result ?? []).flatMap((row) =>
    typeof row.signature === "string"
      ? [{ signature: row.signature, slot: typeof row.slot === "number" ? row.slot : null }]
      : [],
  );
}

export async function walkSignatureGap(input: {
  programId: string;
  fromSlot: number;
  toSlot: number;
  now: Date;
  maxPages?: number;
  pageSize?: number;
  fetchPage: (before: string | null) => Promise<SignatureRow[]>;
}): Promise<{ finished: boolean; checkpoints: RecoveryCheckpoint[]; signatures: SignatureRow[] }> {
  const maxPages = input.maxPages ?? 20;
  const pageSize = input.pageSize ?? 100;
  const signatures: SignatureRow[] = [];
  const checkpoints: RecoveryCheckpoint[] = [];
  let before: string | null = null;
  let finished = false;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await input.fetchPage(before);
    signatures.push(...rows);
    const oldest = rows.reduce<number | null>(
      (slot, row) =>
        row.slot === null ? slot : slot === null ? row.slot : Math.min(slot, row.slot),
      null,
    );
    const passedBound = oldest !== null && oldest < input.fromSlot;
    const truncated =
      rows.length === 0 || (oldest !== null && oldest > input.fromSlot && rows.length < pageSize);
    finished = passedBound;
    const last: string | null = rows.at(-1)?.signature ?? before;
    checkpoints.push({
      programId: input.programId,
      fromSlot: input.fromSlot,
      toSlot: input.toSlot,
      pageBefore: before,
      signaturesSeen: rows.length,
      scanComplete: finished,
      finished,
      recoveryCompletedAt: null,
      recordedAt: input.now,
    });
    if (finished || truncated || !last) break;
    before = last;
  }
  return { finished, checkpoints, signatures };
}

export interface RecoveredEvent {
  signature: string;
  slot: number | null;
  /** When this process stored the event. Not the block time. */
  receivedAt: Date;
  blockTime: Date | null;
  source: "backfill";
  /** A backfill must not become a signal a live follower could have taken. */
  liveSignal: false;
}

/**
 * Scan, then fetch, decode, and persist. A crash after persist and before the
 * completion stamp is resumed from `alreadyStored` without a second economic event.
 */
export async function reconcileWideGap(input: {
  programId: string;
  fromSlot: number;
  toSlot: number;
  now: Date;
  pageLimit?: number;
  pageSize?: number;
  alreadyStored: ReadonlySet<string>;
  fetchPage: (before: string | null) => Promise<SignatureRow[]>;
  fetchTransaction: (
    signature: string,
  ) => Promise<{ ok: true; blockTime: Date | null } | { ok: false }>;
  persist: (event: RecoveredEvent) => Promise<void>;
}): Promise<{
  scanComplete: boolean;
  recoveryComplete: boolean;
  recoveryCompletedAt: Date | null;
  incompleteReason: string | null;
  stored: RecoveredEvent[];
  checkpoints: RecoveryCheckpoint[];
}> {
  let walked: { finished: boolean; checkpoints: RecoveryCheckpoint[]; signatures: SignatureRow[] };
  try {
    walked = await walkSignatureGap({
      programId: input.programId,
      fromSlot: input.fromSlot,
      toSlot: input.toSlot,
      now: input.now,
      maxPages: input.pageLimit,
      pageSize: input.pageSize,
      fetchPage: input.fetchPage,
    });
  } catch {
    return {
      scanComplete: false,
      recoveryComplete: false,
      recoveryCompletedAt: null,
      incompleteReason: "page_failed",
      stored: [],
      checkpoints: [],
    };
  }
  const inGap = walked.signatures.filter((row) => row.slot === null || row.slot >= input.fromSlot);
  if (!walked.finished) {
    return {
      scanComplete: false,
      recoveryComplete: false,
      recoveryCompletedAt: null,
      incompleteReason: "scan_incomplete",
      stored: [],
      checkpoints: walked.checkpoints,
    };
  }
  const stored: RecoveredEvent[] = [];
  for (const row of inGap) {
    if (input.alreadyStored.has(row.signature)) continue;
    let fetched: { ok: true; blockTime: Date | null } | { ok: false };
    try {
      fetched = await input.fetchTransaction(row.signature);
    } catch {
      return {
        scanComplete: true,
        recoveryComplete: false,
        recoveryCompletedAt: null,
        incompleteReason: "tx_fetch_failed",
        stored,
        checkpoints: walked.checkpoints,
      };
    }
    if (!fetched.ok) {
      return {
        scanComplete: true,
        recoveryComplete: false,
        recoveryCompletedAt: null,
        incompleteReason: "decode_failed",
        stored,
        checkpoints: walked.checkpoints,
      };
    }
    const event: RecoveredEvent = {
      signature: row.signature,
      slot: row.slot,
      receivedAt: input.now,
      blockTime: fetched.blockTime,
      source: "backfill",
      liveSignal: false,
    };
    try {
      await input.persist(event);
    } catch {
      return {
        scanComplete: true,
        recoveryComplete: false,
        recoveryCompletedAt: null,
        incompleteReason: "persist_failed",
        stored,
        checkpoints: walked.checkpoints,
      };
    }
    stored.push(event);
  }
  return {
    scanComplete: true,
    recoveryComplete: true,
    recoveryCompletedAt: input.now,
    incompleteReason: null,
    stored,
    checkpoints: walked.checkpoints,
  };
}
