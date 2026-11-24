import { describe, expect, it } from "vitest";

import { serviceEnabled, serviceStartDecision } from "./serviceGate.js";

describe("service gate", () => {
  it("starts a paper or alert service only when the flag is the exact word true", () => {
    expect(serviceEnabled(undefined)).toBe(false);
    expect(serviceEnabled("")).toBe(false);
    expect(serviceEnabled("false")).toBe(false);
    expect(serviceEnabled("TRUE")).toBe(false);
    expect(serviceEnabled("yes")).toBe(false);
    expect(serviceEnabled("true")).toBe(true);
  });

  it("keeps paper off when only the shadow flag is set, and blocks shadow if Telegram is present", () => {
    const shadowOnly = serviceStartDecision({
      paperFlag: "false",
      alertsFlag: undefined,
      outcomesFlag: "false",
      shadowFlag: "true",
    });
    expect(shadowOnly.paper).toBe(false);
    expect(shadowOnly.alerts).toBe(false);
    expect(shadowOnly.shadow).toBe(true);
    const stale = serviceStartDecision({
      paperFlag: "TRUE",
      alertsFlag: "yes",
      outcomesFlag: "true",
      shadowFlag: "true",
      telegramToken: "token",
    });
    expect(stale.paper).toBe(false);
    expect(stale.alerts).toBe(false);
    expect(stale.outcomes).toBe(true);
    expect(stale.shadow).toBe(false);
    expect(stale.shadowBlockedReason).toBe("telegram_credentials_present");
  });
});
