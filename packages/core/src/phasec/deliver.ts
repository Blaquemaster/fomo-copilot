import type { PaperArm, Stage } from "./protocol.js";
import type { PaperEvaluation } from "./paper.js";
import { inQuietHours } from "./time.js";

export function resolveAlertChat(input: {
  destination: "test" | "admin";
  testChatId: string | null;
  adminChatId: string;
}): { chatId: string; destination: "test" | "admin" } | { blocked: true; reason: string } {
  if (input.destination !== "admin") {
    if (!input.testChatId) return { blocked: true, reason: "test chat is not set" };
    if (input.testChatId === input.adminChatId) {
      return { blocked: true, reason: "test chat must not be the admin chat" };
    }
    return { chatId: input.testChatId, destination: "test" };
  }
  return { chatId: input.adminChatId, destination: "admin" };
}

export function breaksQuietHours(input: {
  kind: "entry" | "exit" | "pause" | "tier";
  stage: Stage | null;
  strength: number;
  sizePct: number;
  minStrength: number;
  minSizePct: number;
}): boolean {
  if (input.kind === "exit") return true;
  return (
    input.stage === "post_graduation" &&
    input.strength >= input.minStrength &&
    input.sizePct >= input.minSizePct
  );
}

export function quietHold(input: {
  now: Date;
  quietHours: string;
  kind: "entry" | "exit" | "pause" | "tier";
  stage: Stage | null;
  strength: number;
  sizePct: number;
  minStrength: number;
  minSizePct: number;
}): boolean {
  if (!inQuietHours(input.now, input.quietHours)) return false;
  return !breaksQuietHours(input);
}

export function formatSize(pct: number, bankroll: number | null): string {
  if (bankroll === null) return `${pct.toString()}%`;
  const amount = (bankroll * pct) / 100;
  return `${pct.toString()}% ($${amount.toFixed(2)} of $${bankroll.toFixed(2)})`;
}

export function formatEntry(input: {
  stage: Stage;
  arm: PaperArm;
  mint: string;
  sizePct: number;
  bankroll: number | null;
  strength: number;
  exitPlan: string;
  warnings: readonly string[];
  fingerprint?: string;
  quoteSource?: string | null;
}): string {
  return [
    `${input.stage} ${input.arm}`,
    input.mint,
    `size ${formatSize(input.sizePct, input.bankroll)}`,
    `strength ${input.strength.toFixed(2)}`,
    `exit plan: ${input.exitPlan}`,
    input.warnings.length === 0 ? "screen: pass" : `screen: ${input.warnings.join("; ")}`,
    input.fingerprint ? `config ${input.fingerprint}` : "",
    input.quoteSource === "curve_modeled" ? "quote curve_modeled" : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function formatDigest(lines: readonly string[]): string {
  return ["Morning digest", ...lines].join("\n\n");
}

export function formatWeeklyReview(input: {
  week: string;
  walletChanges: readonly string[];
  xChanges: readonly string[];
  promotionsWaiting: readonly string[];
  paper: PaperEvaluation;
  tradable?: { yes: number; no: number; unknown: number };
  walletScore?: {
    scoringVersion: number;
    lookbackStart: string | null;
    lookbackEnd: string | null;
    entryCount: number;
    cutoff: string | null;
    rankedCount?: number;
  };
  autobuy?: { entries: number; exits: number; paperAlerts: number };
}): string {
  const lines = [
    `Weekly review ${input.week}`,
    `paper ${input.paper.status} alerts ${input.paper.alerts.toString()} bankroll pnl ${
      input.paper.bankrollPnl === null ? "n/a" : input.paper.bankrollPnl.toFixed(4)
    } leave-one-out ${
      input.paper.leaveOneOutPnl === null ? "n/a" : input.paper.leaveOneOutPnl.toFixed(4)
    } median ${input.paper.medianNet === null ? "n/a" : input.paper.medianNet.toFixed(4)} control pnl ${
      input.paper.controlPnl === null ? "n/a" : input.paper.controlPnl.toFixed(4)
    } max drawdown ${input.paper.maxDrawdownPct.toFixed(2)}%`,
    input.tradable
      ? `tradable in fomo: yes ${input.tradable.yes.toString()} no ${input.tradable.no.toString()} unknown ${input.tradable.unknown.toString()}`
      : "tradable in fomo: unknown",
    input.walletScore
      ? `wallet score v${input.walletScore.scoringVersion.toString()} lookback ${input.walletScore.lookbackStart ?? "none"} to ${input.walletScore.lookbackEnd ?? "none"} entries ${input.walletScore.entryCount.toString()} cutoff ${input.walletScore.cutoff ?? "none"} dry-run ${input.walletScore.rankedCount?.toString() ?? "n/a"}`
      : "wallet score: not recorded",
    input.walletChanges.length === 0
      ? "wallet list: no change"
      : `wallet list: ${input.walletChanges.join(", ")}`,
    input.xChanges.length === 0
      ? "x watchlist: no change"
      : `x watchlist: ${input.xChanges.join(", ")}`,
    input.promotionsWaiting.length === 0
      ? "tier promotions waiting: none"
      : `tier promotions waiting: ${input.promotionsWaiting.join(", ")}`,
    input.autobuy
      ? `autobuy dry-run intents ${input.autobuy.entries.toString()} exits ${input.autobuy.exits.toString()} paper alerts ${input.autobuy.paperAlerts.toString()}`
      : "",
  ].filter((line) => line !== "");
  for (const week of input.paper.weeks) {
    lines.push(
      `${week.week} ${week.arm} n=${week.n.toString()} mean=${week.mean.toFixed(4)} median=${week.median.toFixed(4)} p10=${week.p10.toFixed(4)} p90=${week.p90.toFixed(4)}`,
    );
  }
  return lines.join("\n");
}
