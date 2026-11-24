/**
 * Public-RPC signature pages for a gap wider than the 600-slot cap.
 * This does not write raw_events and does not call Helius.
 * A page is finished only when the walker stops inside the slot bound.
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
  fetchPage: (before: string | null) => Promise<SignatureRow[]>;
}): Promise<{ finished: boolean; checkpoints: RecoveryCheckpoint[]; signatures: SignatureRow[] }> {
  const maxPages = input.maxPages ?? 20;
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
    const reached = oldest !== null && oldest <= input.fromSlot;
    const short = rows.length === 0;
    finished = reached || short;
    const last: string | null = rows.at(-1)?.signature ?? before;
    checkpoints.push({
      programId: input.programId,
      fromSlot: input.fromSlot,
      toSlot: input.toSlot,
      pageBefore: before,
      signaturesSeen: rows.length,
      finished,
      recoveryCompletedAt: finished ? input.now : null,
      recordedAt: input.now,
    });
    if (finished || !last) break;
    before = last;
  }
  return { finished, checkpoints, signatures };
}
