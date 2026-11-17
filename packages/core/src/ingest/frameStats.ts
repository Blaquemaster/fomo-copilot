import { SlotGapTracker } from "./reliability.js";

/** Transaction frames only. Slot notifications and ping replies never enter this queue. */
export const TX_QUEUE_BYTE_CAP = 8 * 1024 * 1024;
export const MAX_FRAME_CHARS = 100_000;
/** The deployed handler dropped a frame once one was in flight and one was waiting. */
export const OLD_POLICY_QUEUE_DEPTH = 2;
export const USAGE_FLUSH_MS = 15_000;
export const BUDGET_CACHE_MS = 60_000;
export const SUBSCRIBE_CONFIRM_MS = 10_000;
export const QUEUE_DEPTH_ALERT_MS = 30_000;
export const QUEUE_DEPTH_ALERT_BYTES = 1_048_576;
export const OVERFLOW_SLOT_CAP = 64;
export const HANDLE_SAMPLE_CAP = 512;

export const FRAME_KINDS = ["slot", "tx", "rpc_reply", "confirm", "other"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];

export const DROP_REASONS = [
  "queue_overflow",
  "oversize",
  "bad_json",
  "no_known_instruction",
  "missing_sig_or_slot",
  "missing_mint_or_pool",
] as const;
export type DropReason = (typeof DROP_REASONS)[number];

export type EventSource = "stream" | "audit";

export function isAlertableSource(source: string): boolean {
  return source !== "audit";
}

export function oldPolicyWouldDrop(queueDepth: number): boolean {
  return queueDepth >= OLD_POLICY_QUEUE_DEPTH;
}

export function admitTxBytes(
  queuedBytes: number,
  frameBytes: number,
  cap = TX_QUEUE_BYTE_CAP,
): "keep" | "overflow" {
  if (frameBytes > cap) return "overflow";
  if (queuedBytes + frameBytes > cap) return "overflow";
  return "keep";
}

const SIGNATURE = /"signature"\s*:\s*"([1-9A-HJ-NP-Za-km-z]{32,88})"/;
const SLOT = /"slot"\s*:\s*(\d+)/;

export function extractSignature(text: string): string | null {
  return SIGNATURE.exec(text)?.[1] ?? null;
}

export function extractSlot(text: string): number | null {
  const match = SLOT.exec(text);
  if (!match?.[1]) return null;
  const slot = Number(match[1]);
  return Number.isFinite(slot) ? slot : null;
}

export interface OverflowSpan {
  programId: string;
  fromSlot: number;
  toSlot: number;
  frames: number;
  /** True once the distinct slots no longer fit in memory and the scan must stay inside the backfill cap. */
  collapsed: boolean;
}

/**
 * Bounded record of transaction frames that could not be queued or stored.
 * Flushed to ingest_backfill once the database accepts writes again.
 */
export class OverflowLog {
  private readonly slots = new Map<string, Set<number>>();
  private readonly collapsed = new Map<
    string,
    { fromSlot: number; toSlot: number; frames: number }
  >();

  note(programId: string, slot: number): void {
    const wide = this.collapsed.get(programId);
    if (wide) {
      wide.frames += 1;
      wide.fromSlot = Math.min(wide.fromSlot, slot);
      wide.toSlot = Math.max(wide.toSlot, slot);
      return;
    }
    const set = this.slots.get(programId) ?? new Set<number>();
    set.add(slot);
    this.slots.set(programId, set);
    if (set.size > OVERFLOW_SLOT_CAP) {
      const values = [...set];
      this.collapsed.set(programId, {
        fromSlot: Math.min(...values),
        toSlot: Math.max(...values),
        frames: values.length,
      });
      this.slots.delete(programId);
    }
  }

  get empty(): boolean {
    return this.slots.size === 0 && this.collapsed.size === 0;
  }

  drain(): OverflowSpan[] {
    const spans: OverflowSpan[] = [];
    for (const [programId, set] of this.slots) {
      const values = [...set];
      if (values.length === 0) continue;
      spans.push({
        programId,
        fromSlot: Math.min(...values),
        toSlot: Math.max(...values),
        frames: values.length,
        collapsed: false,
      });
    }
    for (const [programId, span] of this.collapsed) {
      spans.push({ programId, ...span, collapsed: true });
    }
    this.slots.clear();
    this.collapsed.clear();
    return spans;
  }
}

export interface FrameHourRow {
  hour: string;
  kind: string;
  dropReason: string;
  received: number;
  queued: number;
  dropped: number;
  shadowDropped: number;
  bytes: bigint;
  maxQueueDepth: number;
  maxHandleMs: number;
  p99HandleMs: number;
  slotsSeen: number;
  slotGaps: number;
}

export function hourStartIso(now: Date): string {
  const copy = new Date(now.getTime());
  copy.setUTCMinutes(0, 0, 0);
  return copy.toISOString();
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank))] ?? 0;
}

interface KindCounts {
  received: number;
  queued: number;
  dropped: number;
  bytes: bigint;
}

/**
 * In-memory frame counters for the current hour. Additive fields are deltas
 * since the last successful flush. Gauges cover the hour so far.
 */
export class FrameStats {
  private hour = "";
  private readonly kinds = new Map<string, KindCounts>();
  private shadowDropped = 0;
  private maxQueueDepth = 0;
  private maxHandleMs = 0;
  private readonly handleSamples: number[] = [];
  private slotsSeen = 0;
  private slotGaps = 0;
  private readonly slotTracker = new SlotGapTracker();
  private drainedSlots = 0;
  private drainedGaps = 0;
  private warned = new Set<string>();

  noteReceived(kind: FrameKind, bytes: number, now: Date): void {
    this.roll(now);
    const row = this.kind(kind, "");
    row.received += 1;
    row.bytes += BigInt(bytes);
  }

  noteQueued(kind: FrameKind, now: Date): void {
    this.roll(now);
    this.kind(kind, "").queued += 1;
  }

  noteDropped(kind: FrameKind, reason: DropReason, bytes: number, now: Date): boolean {
    this.roll(now);
    const row = this.kind(kind, reason);
    row.dropped += 1;
    row.bytes += BigInt(bytes);
    const key = `${this.hour}:${reason}`;
    if (this.warned.has(key)) return false;
    this.warned.add(key);
    return true;
  }

  noteShadow(queueDepth: number, now: Date): void {
    this.roll(now);
    if (oldPolicyWouldDrop(queueDepth)) this.shadowDropped += 1;
  }

  noteQueueDepth(depth: number, now: Date): void {
    this.roll(now);
    if (depth > this.maxQueueDepth) this.maxQueueDepth = depth;
  }

  noteHandleMs(ms: number, now: Date): void {
    this.roll(now);
    const rounded = Math.max(0, Math.round(ms));
    if (rounded > this.maxHandleMs) this.maxHandleMs = rounded;
    if (this.handleSamples.length < HANDLE_SAMPLE_CAP) this.handleSamples.push(rounded);
  }

  noteSlot(slot: number, now: Date): void {
    this.roll(now);
    this.slotTracker.note(slot);
    this.slotsSeen = this.slotTracker.slotsSeen - this.drainedSlots;
    this.slotGaps = this.slotTracker.slotGaps - this.drainedGaps;
  }

  /** Rows to add. Empty when nothing happened. Gauges are repeated on the meta row only. */
  drain(now: Date): FrameHourRow[] {
    if (this.hour === "") return [];
    const rows: FrameHourRow[] = [];
    for (const [key, counts] of this.kinds) {
      const split = key.indexOf("|");
      const kind = key.slice(0, split);
      const dropReason = key.slice(split + 1);
      if (counts.received === 0 && counts.queued === 0 && counts.dropped === 0) continue;
      rows.push({
        hour: this.hour,
        kind,
        dropReason,
        received: counts.received,
        queued: counts.queued,
        dropped: counts.dropped,
        shadowDropped: 0,
        bytes: counts.bytes,
        maxQueueDepth: 0,
        maxHandleMs: 0,
        p99HandleMs: 0,
        slotsSeen: 0,
        slotGaps: 0,
      });
      counts.received = 0;
      counts.queued = 0;
      counts.dropped = 0;
      counts.bytes = 0n;
    }
    const gauges =
      this.shadowDropped > 0 ||
      this.maxQueueDepth > 0 ||
      this.maxHandleMs > 0 ||
      this.slotsSeen > 0 ||
      this.slotGaps > 0;
    if (gauges) {
      rows.push({
        hour: this.hour,
        kind: "meta",
        dropReason: "",
        received: 0,
        queued: 0,
        dropped: 0,
        shadowDropped: this.shadowDropped,
        bytes: 0n,
        maxQueueDepth: this.maxQueueDepth,
        maxHandleMs: this.maxHandleMs,
        p99HandleMs: percentile(this.handleSamples, 99),
        slotsSeen: this.slotsSeen,
        slotGaps: this.slotGaps,
      });
      this.shadowDropped = 0;
      this.drainedSlots = this.slotTracker.slotsSeen;
      this.drainedGaps = this.slotTracker.slotGaps;
      this.slotsSeen = 0;
      this.slotGaps = 0;
      this.maxQueueDepth = 0;
      this.maxHandleMs = 0;
      this.handleSamples.length = 0;
    }
    this.roll(now);
    return rows;
  }

  restore(rows: readonly FrameHourRow[]): void {
    for (const row of rows) {
      if (row.kind === "meta") {
        this.shadowDropped += row.shadowDropped;
        this.slotsSeen += row.slotsSeen;
        this.slotGaps += row.slotGaps;
        this.maxQueueDepth = Math.max(this.maxQueueDepth, row.maxQueueDepth);
        this.maxHandleMs = Math.max(this.maxHandleMs, row.maxHandleMs);
        continue;
      }
      const counts = this.kind(row.kind, row.dropReason);
      counts.received += row.received;
      counts.queued += row.queued;
      counts.dropped += row.dropped;
      counts.bytes += row.bytes;
    }
  }

  private roll(now: Date): void {
    const hour = hourStartIso(now);
    if (this.hour === "") {
      this.hour = hour;
      return;
    }
    if (this.hour === hour || this.pending()) return;
    this.hour = hour;
    this.kinds.clear();
    this.shadowDropped = 0;
    this.maxQueueDepth = 0;
    this.maxHandleMs = 0;
    this.handleSamples.length = 0;
    this.slotsSeen = 0;
    this.slotGaps = 0;
    this.warned.clear();
  }

  private pending(): boolean {
    if (this.shadowDropped > 0 || this.slotsSeen > 0 || this.slotGaps > 0) return true;
    for (const counts of this.kinds.values()) {
      if (counts.received > 0 || counts.queued > 0 || counts.dropped > 0) return true;
    }
    return false;
  }

  private kind(kind: string, dropReason: string): KindCounts {
    const key = `${kind}|${dropReason}`;
    const existing = this.kinds.get(key);
    if (existing) return existing;
    const created = { received: 0, queued: 0, dropped: 0, bytes: 0n };
    this.kinds.set(key, created);
    return created;
  }
}

export class UsageLedger {
  streamedBytes = 0n;
  messages = 0;
  storedEvents = 0;
  creditMicros = 0n;

  add(input: {
    streamedBytes?: bigint;
    messages?: number;
    storedEvents?: number;
    creditMicros?: bigint;
  }): void {
    this.streamedBytes += input.streamedBytes ?? 0n;
    this.messages += input.messages ?? 0;
    this.storedEvents += input.storedEvents ?? 0;
    this.creditMicros += input.creditMicros ?? 0n;
  }

  drain(): {
    streamedBytes: bigint;
    messages: number;
    storedEvents: number;
    creditMicros: bigint;
  } {
    const snapshot = {
      streamedBytes: this.streamedBytes,
      messages: this.messages,
      storedEvents: this.storedEvents,
      creditMicros: this.creditMicros,
    };
    this.streamedBytes = 0n;
    this.messages = 0;
    this.storedEvents = 0;
    this.creditMicros = 0n;
    return snapshot;
  }
}

const SLOTS_PER_SECOND = 1000 / 215;

export interface AuditWindow {
  fromSlot: number;
  toSlot: number;
}

/** One window inside the previous 6 hours, ending at least 30 minutes ago. */
export function planAuditWindow(input: {
  nowMs: number;
  tipSlot: number;
  programId: string;
  spanSlots?: number;
}): AuditWindow {
  const span = input.spanSlots ?? Math.round(15 * 60 * SLOTS_PER_SECOND);
  const horizon = Math.round(6 * 60 * 60 * SLOTS_PER_SECOND);
  const quiet = Math.round(30 * 60 * SLOTS_PER_SECOND);
  const newestEnd = input.tipSlot - quiet;
  const oldestStart = Math.max(0, input.tipSlot - horizon);
  const room = Math.max(0, newestEnd - span - oldestStart);
  const bucket = Math.floor(input.nowMs / (6 * 60 * 60 * 1000));
  const hash = fnv(`${input.programId}:${bucket.toString()}`);
  const start = oldestStart + (room === 0 ? 0 : hash % (room + 1));
  return { fromSlot: start, toSlot: start + span };
}

/**
 * A window that starts before this venue's stream was live is not a miss.
 * Clamp the start up to coverage, or skip the window when none of it is covered.
 */
export function coverAuditWindow(input: {
  window: AuditWindow;
  coverageSlot: number | null;
}): { action: "skip" } | { action: "scan"; fromSlot: number; toSlot: number } {
  if (input.coverageSlot === null || input.window.toSlot <= input.coverageSlot) {
    return { action: "skip" };
  }
  const fromSlot = Math.max(input.window.fromSlot, input.coverageSlot);
  if (fromSlot >= input.window.toSlot) return { action: "skip" };
  return { action: "scan", fromSlot, toSlot: input.window.toSlot };
}

export function recallLoss(missed: number, expected: number): number | null {
  if (expected <= 0) return null;
  return missed / expected;
}

export function recallShouldAlert(input: {
  windowMissed: number;
  sevenDayMissed: number;
  sevenDayExpected: number;
}): { window: boolean; week: boolean } {
  const loss = recallLoss(input.sevenDayMissed, input.sevenDayExpected);
  return {
    window: input.windowMissed > 2,
    week: loss !== null && loss > 0.01,
  };
}

export function diffSignatures(
  expected: readonly string[],
  stored: ReadonlySet<string>,
): { matched: string[]; missed: string[] } {
  const matched: string[] = [];
  const missed: string[] = [];
  const seen = new Set<string>();
  for (const signature of expected) {
    if (seen.has(signature)) continue;
    seen.add(signature);
    if (stored.has(signature)) matched.push(signature);
    else missed.push(signature);
  }
  return { matched, missed };
}

function fnv(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
