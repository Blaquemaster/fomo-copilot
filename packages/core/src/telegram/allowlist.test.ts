import { describe, expect, it } from "vitest";

import { isAllowlistedAdmin } from "./allowlist.js";

describe("isAllowlistedAdmin", () => {
  it("allows only the configured private chat id", () => {
    expect(isAllowlistedAdmin(424242, "424242")).toBe(true);
    expect(isAllowlistedAdmin("424242", "424242")).toBe(true);
    expect(isAllowlistedAdmin(424242, " 424242 ")).toBe(true);
  });

  it("rejects other chats, missing chats, and a bad allow-list value", () => {
    expect(isAllowlistedAdmin(111, "424242")).toBe(false);
    expect(isAllowlistedAdmin(undefined, "424242")).toBe(false);
    expect(isAllowlistedAdmin(424242, "0")).toBe(false);
    expect(isAllowlistedAdmin(424242, "not-a-number")).toBe(false);
    expect(isAllowlistedAdmin(-100123, "-100123")).toBe(false);
  });
});
