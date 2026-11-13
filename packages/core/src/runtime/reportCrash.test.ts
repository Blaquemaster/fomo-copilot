import { Writable } from "node:stream";

import { beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../log/logger.js";
import { deliverCrashAlert, resetCrashDeliveryStateForTests } from "./reportCrash.js";

describe("deliverCrashAlert", () => {
  beforeEach(() => {
    resetCrashDeliveryStateForTests();
  });

  it("sends a redacted fatal alert", async () => {
    const secret = "example-db-password";
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { text: string };
      bodies.push(body.text);
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };
    const logger = createLogger({
      level: "info",
      app: "alerter",
      secrets: [secret],
      destination: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    });

    await deliverCrashAlert({
      app: "alerter",
      kind: "crash_test",
      error: new Error(`intentional ${secret}`),
      token: "test-token-value",
      chatId: "424242",
      secrets: [secret],
      logger,
      fatal: true,
      now: new Date("2026-11-13T12:00:00.000Z"),
      host: "test-host",
      fetchImpl,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("kind: crash_test");
    expect(bodies[0]).toContain("app: alerter");
    expect(bodies[0]).not.toContain(secret);
  });

  it("sends at most one non-fatal alert per minute", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    };
    const logger = createLogger({
      level: "error",
      app: "alerter",
      destination: new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    });
    const base = {
      app: "alerter",
      kind: "handler" as const,
      error: new Error("handler failed"),
      token: "test-token-value",
      chatId: "424242",
      secrets: [],
      logger,
      fatal: false,
      host: "test-host",
      fetchImpl,
    };
    await deliverCrashAlert({ ...base, now: new Date("2026-11-13T12:00:00.000Z") });
    await deliverCrashAlert({ ...base, now: new Date("2026-11-13T12:00:30.000Z") });
    await deliverCrashAlert({ ...base, now: new Date("2026-11-13T12:01:01.000Z") });
    expect(calls).toBe(2);
  });
});
