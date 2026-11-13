import { redactString } from "../log/redact.js";

/** Telegram sendMessage text limit after entity parsing. Plain text uses the same cap. */
export const TELEGRAM_TEXT_LIMIT = 4096;

export const CRASH_KINDS = [
  "uncaughtException",
  "unhandledRejection",
  "crash_test",
  "handler",
] as const;

export type CrashKind = (typeof CRASH_KINDS)[number];

export function truncateTelegramText(text: string): string {
  if (text.length <= TELEGRAM_TEXT_LIMIT) return text;
  const marker = "\n[truncated]";
  return text.slice(0, TELEGRAM_TEXT_LIMIT - marker.length) + marker;
}

function errorToText(error: unknown): string {
  if (error instanceof Error) {
    const stack = error.stack === undefined ? "" : `\n${error.stack}`;
    return `${error.name}: ${error.message}${stack}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unprintable error";
  }
}

export function formatCrashAlert(input: {
  app: string;
  kind: CrashKind;
  error: unknown;
  now: Date;
  host: string;
  secrets?: readonly string[];
}): string {
  const body = [
    "FOMO copilot crash",
    `app: ${input.app}`,
    `kind: ${input.kind}`,
    `host: ${input.host}`,
    `time: ${input.now.toISOString()}`,
    "error:",
    errorToText(input.error),
  ].join("\n");
  return truncateTelegramText(redactString(body, input.secrets ?? []));
}
