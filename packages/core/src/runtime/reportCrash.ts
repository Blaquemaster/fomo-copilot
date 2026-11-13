import type { Logger } from "../log/logger.js";
import { formatCrashAlert, type CrashKind } from "../telegram/crashAlert.js";
import { sendTelegramMessage } from "../telegram/sendMessage.js";

const NON_FATAL_INTERVAL_MS = 60_000;

let lastNonFatalMs = 0;
let fatalSent = false;

export function resetCrashDeliveryStateForTests(): void {
  lastNonFatalMs = 0;
  fatalSent = false;
}

export async function deliverCrashAlert(options: {
  app: string;
  kind: CrashKind;
  error: unknown;
  token: string;
  chatId: string;
  secrets: readonly string[];
  logger: Logger;
  fatal: boolean;
  now?: Date;
  host?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const nowMs = (options.now ?? new Date()).getTime();
  if (options.fatal) {
    if (fatalSent) return;
    fatalSent = true;
  } else if (nowMs - lastNonFatalMs < NON_FATAL_INTERVAL_MS) {
    options.logger.warn({ kind: options.kind }, "suppressed repeated non-fatal crash alert");
    return;
  } else {
    lastNonFatalMs = nowMs;
  }

  const text = formatCrashAlert({
    app: options.app,
    kind: options.kind,
    error: options.error,
    now: options.now ?? new Date(nowMs),
    host: options.host ?? "unknown",
    secrets: options.secrets,
  });

  try {
    await sendTelegramMessage({
      token: options.token,
      chatId: options.chatId,
      text,
      fetchImpl: options.fetchImpl,
      signal: AbortSignal.timeout(10_000),
    });
    options.logger.info({ kind: options.kind, fatal: options.fatal }, "crash alert delivered");
  } catch (error) {
    options.logger.error({ err: error, kind: options.kind }, "crash alert delivery failed");
  }
}
