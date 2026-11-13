import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "./logger.js";

describe("createLogger", () => {
  it("writes structured JSON and never includes configured secrets", async () => {
    const secret = "example-db-password";
    const token = "test-token-value";
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({
      level: "info",
      app: "ingestor",
      secrets: [secret, token],
      destination,
    });
    const failure = new Error(`request failed for bot token ${token}`);
    logger.info(
      {
        password: secret,
        err: failure,
        DATABASE_URL: `postgres://fomo:${secret}@postgres:5432/fomo`,
      },
      `startup using ${secret}`,
    );

    await new Promise((resolve) => setImmediate(resolve));
    const text = lines.join("");
    expect(text.length).toBeGreaterThan(0);
    const record = JSON.parse(text) as { level: string; app: string; msg: string };
    expect(record.level).toBe("info");
    expect(record.app).toBe("ingestor");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(token);
    expect(text).toContain("[REDACTED]");
    expect(record.msg).toContain("[REDACTED]");
  });
});
