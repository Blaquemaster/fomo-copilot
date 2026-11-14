import { describe, expect, it } from "vitest";

import { ConfigError } from "./error.js";
import { loadEnv, secretValuesFromEnv } from "./env.js";

const password = "example-db-password";
const token = "test-token-value";
const helius = "helius-test-key";

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    LOG_LEVEL: "info",
    POSTGRES_USER: "fomo",
    POSTGRES_PASSWORD: password,
    POSTGRES_DB: "fomo",
    DATABASE_URL: `postgres://fomo:${password}@postgres:5432/fomo`,
    TELEGRAM_BOT_TOKEN: token,
    TELEGRAM_ADMIN_CHAT_ID: "424242",
    HELIUS_API_KEY: helius,
    PATH: "/usr/bin",
    ...overrides,
  };
}

describe("loadEnv", () => {
  it("accepts a complete environment and ignores unrelated variables", () => {
    const env = loadEnv(validEnv());
    expect(env.NODE_ENV).toBe("test");
    expect(env.TELEGRAM_ADMIN_CHAT_ID).toBe("424242");
    expect(env.POSTGRES_USER).toBe("fomo");
    expect(env.THRESHOLDS_PATH).toBeUndefined();
    expect(env.BACKFILL_SLOT_MARGIN).toBe(16);
  });

  it("defaults NODE_ENV and LOG_LEVEL when they are absent", () => {
    const source = validEnv();
    delete source.NODE_ENV;
    delete source.LOG_LEVEL;
    const env = loadEnv(source);
    expect(env.NODE_ENV).toBe("development");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("rejects an invalid admin chat id without echoing the supplied value", () => {
    const leaked = "this-value-must-not-leak";
    expect(() => loadEnv(validEnv({ TELEGRAM_ADMIN_CHAT_ID: leaked }))).toThrow(ConfigError);
    try {
      loadEnv(validEnv({ TELEGRAM_ADMIN_CHAT_ID: leaked }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).not.toContain(leaked);
      expect((error as Error).message).toContain("TELEGRAM_ADMIN_CHAT_ID");
    }
  });

  it("rejects a database URL that does not match the postgres settings, without echoing secrets", () => {
    const leaked = "postgres://fomo:other-secret-password@postgres:5432/fomo";
    expect(() => loadEnv(validEnv({ DATABASE_URL: leaked }))).toThrow(ConfigError);
    try {
      loadEnv(validEnv({ DATABASE_URL: leaked }));
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(password);
      expect(message).not.toContain("other-secret-password");
      expect(message).not.toContain(leaked);
      expect(message).toContain("DATABASE_URL");
    }
  });

  it("rejects chat id 0 and a token that contains whitespace", () => {
    expect(() => loadEnv(validEnv({ TELEGRAM_ADMIN_CHAT_ID: "0" }))).toThrow(
      /TELEGRAM_ADMIN_CHAT_ID/,
    );
    expect(() => loadEnv(validEnv({ TELEGRAM_BOT_TOKEN: "token with spaces" }))).toThrow(
      /TELEGRAM_BOT_TOKEN/,
    );
  });

  it("collects secret values and their URL-encoded forms", () => {
    const env = loadEnv(validEnv());
    const secrets = secretValuesFromEnv(env);
    expect(secrets).toContain(password);
    expect(secrets).toContain(token);
    expect(secrets).toContain(helius);
  });
});
