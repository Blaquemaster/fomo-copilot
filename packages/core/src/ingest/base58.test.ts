import { describe, expect, it } from "vitest";

import { decodeBase58, encodeBase58 } from "./base58.js";

describe("base58", () => {
  it("round-trips a pubkey and the well-known 32 zero-byte address", () => {
    const zeros = new Uint8Array(32);
    expect(encodeBase58(zeros)).toBe("11111111111111111111111111111111");
    expect(decodeBase58("11111111111111111111111111111111")).toEqual(zeros);
    const sample = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    expect(decodeBase58(encodeBase58(sample))).toEqual(sample);
  });
});
