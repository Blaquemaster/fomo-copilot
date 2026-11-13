import { describe, expect, it } from "vitest";

import { formatCrashAlert, TELEGRAM_TEXT_LIMIT } from "./crashAlert.js";

describe("formatCrashAlert", () => {
  it("includes the app, kind, and error, and strips secrets", () => {
    const secret = "example-db-password";
    const shaped = `${"123456789"}:${"B".repeat(35)}`;
    const text = formatCrashAlert({
      app: "ingestor",
      kind: "crash_test",
      error: new Error(`boom ${secret} ${shaped}`),
      now: new Date("2026-11-13T12:00:00.000Z"),
      host: "test-host",
      secrets: [secret],
    });
    expect(text).toContain("app: ingestor");
    expect(text).toContain("kind: crash_test");
    expect(text).toContain("host: test-host");
    expect(text).toContain("time: 2026-11-13T12:00:00.000Z");
    expect(text).toContain("Error: boom");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(shaped);
    expect(text).toContain("[REDACTED]");
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("truncates oversized alerts to the Telegram text limit", () => {
    const text = formatCrashAlert({
      app: "screener",
      kind: "uncaughtException",
      error: new Error("x".repeat(10_000)),
      now: new Date("2026-11-13T12:00:00.000Z"),
      host: "test-host",
    });
    expect(text.length).toBe(TELEGRAM_TEXT_LIMIT);
    expect(text.endsWith("\n[truncated]")).toBe(true);
    expect(text).toContain("app: screener");
  });
});
