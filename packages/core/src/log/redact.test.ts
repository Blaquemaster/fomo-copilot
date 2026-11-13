import { describe, expect, it } from "vitest";

import { redact, redactString } from "./redact.js";

describe("redact", () => {
  it("removes sensitive keys and nested copies of known secrets", () => {
    const password = "example-db-password";
    const token = "test-token-value";
    const redacted = redact(
      {
        password,
        nested: { HELIUS_API_KEY: "helius-test-key", note: `db password is ${password}` },
        TELEGRAM_BOT_TOKEN: token,
        DATABASE_URL: `postgres://fomo:${password}@postgres:5432/fomo`,
        ok: "visible",
      },
      [password, token, "helius-test-key"],
    );
    const text = JSON.stringify(redacted);
    expect(text).not.toContain(password);
    expect(text).not.toContain(token);
    expect(text).not.toContain("helius-test-key");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("visible");
  });

  it("redacts telegram-shaped tokens and bearer secrets inside strings", () => {
    const shaped = `${"123456789"}:${"A".repeat(35)}`;
    const text = redactString(
      `failed https://api.telegram.org/bot${shaped}/sendMessage Authorization: Bearer ${"abc".repeat(8)}`,
    );
    expect(text).not.toContain(shaped);
    expect(text).not.toContain("abcabc");
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("Bearer [REDACTED]");
  });

  it("redacts error messages and breaks circular references", () => {
    const secret = "example-db-password";
    const error = new Error(`connect ${secret}`);
    const box: { self?: unknown; err: Error } = { err: error };
    box.self = box;
    const redacted = redact(box, [secret]) as { err: { message: string }; self: unknown };
    expect(redacted.err.message).not.toContain(secret);
    expect(redacted.self).toBe("[Circular]");
  });
});
