import { describe, expect, it } from "vitest";

import { serviceEnabled } from "./serviceGate.js";

describe("service gate", () => {
  it("starts a paper or alert service only when the flag is the exact word true", () => {
    expect(serviceEnabled(undefined)).toBe(false);
    expect(serviceEnabled("")).toBe(false);
    expect(serviceEnabled("false")).toBe(false);
    expect(serviceEnabled("TRUE")).toBe(false);
    expect(serviceEnabled("yes")).toBe(false);
    expect(serviceEnabled("true")).toBe(true);
  });
});
