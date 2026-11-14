const BASE_MS = 1_000;
const CAP_MS = 30_000;

/** Exponential backoff with up to 20% jitter. Attempt 1 is the first retry. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(CAP_MS, BASE_MS * 2 ** (safeAttempt - 1));
  const unit = random();
  const jitter = exponential * 0.2 * (Number.isFinite(unit) ? Math.min(1, Math.max(0, unit)) : 0);
  return Math.round(exponential + jitter);
}

/** Helius/Solana -32015 means the client asked for a transaction version it did not accept. */
export function nextTransactionVersion(code: number | null, attempt: number): number | null {
  if (code === -32015 && attempt === 0) return 1;
  return null;
}

/** In-process dedupe in front of the signature unique key in Postgres. */
export class SignatureWindow {
  private readonly seen = new Set<string>();

  constructor(private readonly max = 5_000) {}

  get size(): number {
    return this.seen.size;
  }

  /** Returns false when this signature and event index were already seen. */
  add(signature: string, eventIndex: number): boolean {
    const key = `${signature}:${eventIndex.toString()}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    while (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value;
      if (typeof oldest !== "string") break;
      this.seen.delete(oldest);
    }
    return true;
  }
}

/**
 * Insertion-ordered set that forgets the oldest entry past `max`.
 * Used for one-time log notes so a long process cannot grow without a bound.
 */
export class BoundedSet {
  private readonly items = new Set<string>();

  constructor(private readonly max: number) {}

  get size(): number {
    return this.items.size;
  }

  /** Returns true the first time `value` is added. */
  add(value: string): boolean {
    if (this.items.has(value)) return false;
    this.items.add(value);
    while (this.items.size > this.max) {
      const oldest = this.items.values().next().value;
      if (typeof oldest !== "string") break;
      this.items.delete(oldest);
    }
    return true;
  }
}

/** Clears intervals and runs listener cleanups. One bag per socket. */
export class DisposableBag {
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private cleanups: Array<() => void> = [];
  private disposed = false;

  interval(fn: () => void, ms: number): ReturnType<typeof setInterval> {
    const timer = setInterval(fn, ms);
    if (this.disposed) {
      clearInterval(timer);
      return timer;
    }
    this.timers.push(timer);
    return timer;
  }

  add(cleanup: () => void): void {
    if (this.disposed) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
  }

  get pending(): number {
    return this.timers.length + this.cleanups.length;
  }
}

export const LIVENESS_WARN_MS = 30_000;
export const LIVENESS_CRITICAL_MS = 90_000;

export type LivenessLevel = "ok" | "warn" | "critical";

/**
 * Dead-connection check. Evidence is a WebSocket pong or an advancing slot,
 * not an ingest event. A quiet program is not a dead socket.
 */
export function livenessLevel(input: {
  nowMs: number;
  connectedAtMs: number;
  lastEvidenceAtMs: number | null;
  warnMs?: number;
  criticalMs?: number;
}): LivenessLevel {
  const warnMs = input.warnMs ?? LIVENESS_WARN_MS;
  const criticalMs = input.criticalMs ?? LIVENESS_CRITICAL_MS;
  const latest = Math.max(input.connectedAtMs, input.lastEvidenceAtMs ?? input.connectedAtMs);
  const age = input.nowMs - latest;
  if (age >= criticalMs) return "critical";
  if (age >= warnMs) return "warn";
  return "ok";
}

/**
 * Telegram only when a reconnect fails to open, once per outage.
 * A socket that opened and then went quiet-dead is a routine reconnect.
 */
export function nextReconnectAlert(input: { opened: boolean; outageAlerted: boolean }): {
  alert: boolean;
  outageAlerted: boolean;
} {
  if (input.opened) return { alert: false, outageAlerted: false };
  if (input.outageAlerted) return { alert: false, outageAlerted: true };
  return { alert: true, outageAlerted: true };
}

export function measureReconnectGap(input: {
  nowMs: number;
  lastLiveAtMs: number | null;
  lastSlot: number | null;
  currentSlot: number | null;
}): { gapSeconds: number | null; gapSlots: number | null; untilSlot: number | null } {
  const gapSeconds =
    input.lastLiveAtMs === null
      ? null
      : Math.max(0, Math.round((input.nowMs - input.lastLiveAtMs) / 1000));
  const gapSlots =
    input.lastSlot === null || input.currentSlot === null
      ? null
      : Math.max(0, input.currentSlot - input.lastSlot);
  return { gapSeconds, gapSlots, untilSlot: input.lastSlot };
}

/** Page cap and getTransaction cap for one program on one reconnect. Each page or tx is 1 credit. */
export const BACKFILL_PAGE_CAP = 40;
export const BACKFILL_TX_CAP = 60;

export function signaturesToRecover(input: {
  missingNewestFirst: readonly string[];
  txCap: number;
}): { signatures: string[]; truncated: boolean } {
  const cap = Math.max(0, Math.floor(input.txCap));
  return {
    signatures: input.missingNewestFirst.slice(0, cap),
    truncated: input.missingNewestFirst.length > cap,
  };
}

export interface BackfillSignature {
  signature: string;
  slot: number | null;
}

/**
 * Signature pages from getSignaturesForAddress are newest-first.
 * Missing signatures are those strictly newer than the checkpoint.
 */
export function signaturesNewerThanCheckpoint(input: {
  newestFirst: readonly string[];
  checkpoint: string | null;
}): { missing: string[]; reachedCheckpoint: boolean } {
  if (input.checkpoint === null) {
    return { missing: [], reachedCheckpoint: true };
  }
  const index = input.newestFirst.indexOf(input.checkpoint);
  if (index === -1) {
    return { missing: [...input.newestFirst], reachedCheckpoint: false };
  }
  return { missing: input.newestFirst.slice(0, index), reachedCheckpoint: true };
}

export interface BackfillStep {
  missing: string[];
  fetchAnotherPage: boolean;
  gapRemains: boolean;
}

/**
 * Stop at the checkpoint signature, or at the first row whose slot is already covered.
 * Covered means slot <= the last live slot, or slot <= the stored checkpoint slot when
 * the live cursor is absent. The stored event signature is often far behind the program
 * tip, so an exact-signature search pages through unrelated history.
 */
export function planBackfillPage(input: {
  newestFirst: readonly (string | BackfillSignature)[];
  checkpoint: string | null;
  checkpointSlot?: number | null;
  untilSlot?: number | null;
  pageWasFull: boolean;
  pagesFetched: number;
  maxPages: number;
}): BackfillStep {
  if (input.checkpoint === null && input.untilSlot == null && input.checkpointSlot == null) {
    return { missing: [], fetchAnotherPage: false, gapRemains: false };
  }
  const stopSlots = [input.untilSlot, input.checkpointSlot].filter(
    (slot): slot is number => typeof slot === "number",
  );
  const stopSlot = stopSlots.length === 0 ? null : Math.max(...stopSlots);
  const missing: string[] = [];
  let reached = false;
  for (const row of input.newestFirst) {
    const signature = typeof row === "string" ? row : row.signature;
    const slot = typeof row === "string" ? null : row.slot;
    if (input.checkpoint !== null && signature === input.checkpoint) {
      reached = true;
      break;
    }
    if (slot !== null && stopSlot !== null && slot <= stopSlot) {
      reached = true;
      break;
    }
    missing.push(signature);
  }
  if (reached) return { missing, fetchAnotherPage: false, gapRemains: false };
  const canContinue = input.pageWasFull && input.pagesFetched < input.maxPages;
  return { missing, fetchAnotherPage: canContinue, gapRemains: !canContinue };
}
