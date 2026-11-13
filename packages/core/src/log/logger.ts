import pino from "pino";
import type { Level, Logger as PinoLogger } from "pino";

import { redact, redactString } from "./redact.js";

export interface Logger {
  debug(message: string): void;
  debug(fields: Record<string, unknown>, message: string): void;
  info(message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  warn(message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface LoggerOptions {
  level: Level;
  app: string;
  secrets?: readonly string[];
  destination?: NodeJS.WritableStream;
}

export function createLogger(options: LoggerOptions): Logger {
  const secrets = options.secrets ?? [];
  const base: PinoLogger = pino(
    {
      level: options.level,
      base: { app: options.app },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) {
          return { level: label };
        },
      },
    },
    options.destination,
  );

  function write(level: Level, first: string | Record<string, unknown>, second?: string): void {
    if (typeof first === "string") {
      base[level](redactString(first, secrets));
      return;
    }
    const fields = redact(first, secrets);
    const message = second === undefined ? undefined : redactString(second, secrets);
    if (message === undefined) {
      base[level](fields as Record<string, unknown>);
      return;
    }
    base[level](fields as Record<string, unknown>, message);
  }

  return {
    debug(first: string | Record<string, unknown>, second?: string) {
      write("debug", first, second);
    },
    info(first: string | Record<string, unknown>, second?: string) {
      write("info", first, second);
    },
    warn(first: string | Record<string, unknown>, second?: string) {
      write("warn", first, second);
    },
    error(first: string | Record<string, unknown>, second?: string) {
      write("error", first, second);
    },
  };
}
