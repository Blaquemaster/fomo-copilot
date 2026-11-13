import { TELEGRAM_TEXT_LIMIT, truncateTelegramText } from "../telegram/crashAlert.js";
import { formatCredits } from "./budget.js";
import type { EventKind } from "./programs.js";

export interface IngestStatusView {
  state: string;
  wsMethod: string;
  plan: string;
  mode: string;
  pausedNonEssential: boolean;
  lastSlot: string | null;
  updatedAt: string | null;
  eventsToday: number;
  bytesToday: string;
  creditsToday: string;
  projected30d: string;
  allowance: string;
  monthUsedPct: string;
  stale: boolean;
}

export function formatIngestStatus(view: IngestStatusView): string {
  const state = view.stale ? `${view.state} (stale)` : view.state;
  return [
    "ingest status",
    `state: ${state}`,
    `method: ${view.wsMethod}`,
    `plan: ${view.plan}`,
    `mode: ${view.mode}`,
    `paused non-essential: ${view.pausedNonEssential ? "yes" : "no"}`,
    `last slot: ${view.lastSlot ?? "none"}`,
    `events today: ${view.eventsToday.toString()}`,
    `bytes today: ${view.bytesToday}`,
    `credits today: ${view.creditsToday}`,
    `projected credits / 30d: ${view.projected30d}`,
    `monthly allowance: ${view.allowance}`,
    `month used: ${view.monthUsedPct}`,
  ].join("\n");
}

export interface SpotCheckRow {
  signature: string;
  slot: string;
  kind: EventKind | string;
  mint: string | null;
  pool: string | null;
}

export function formatSpotCheck(rows: readonly SpotCheckRow[]): string {
  if (rows.length === 0) return "no stored events yet";
  const lines = ["recent ingest events", ""];
  rows.forEach((row, index) => {
    lines.push(
      `${(index + 1).toString()} ${row.kind} slot ${row.slot}`,
      `mint: ${row.mint ?? "unknown"}`,
      `pool: ${row.pool ?? "unknown"}`,
      `https://solscan.io/tx/${row.signature}`,
    );
    if (row.mint) lines.push(`https://solscan.io/token/${row.mint}`);
    if (row.pool) lines.push(`https://solscan.io/account/${row.pool}`);
    lines.push("");
  });
  return truncateTelegramText(lines.join("\n").trimEnd());
}

export function monthUsedPercent(usedMicros: bigint, allowanceCredits: bigint): string {
  if (allowanceCredits <= 0n) return "n/a";
  const pct = (usedMicros * 10_000n) / (allowanceCredits * 1_000_000n);
  const whole = pct / 100n;
  const frac = pct % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
}

export { formatCredits, TELEGRAM_TEXT_LIMIT };
