import { describe, expect, it } from "vitest";

import {
  FLAP_LAUNCHPAD,
  FLAP_PORTAL,
  TOPIC_LAUNCHED_TO_DEX,
  TOPIC_TAX_SET,
  TOPIC_TOKEN_CREATED,
  decodePortalLog,
  decodeTokenStateV8,
  encodeGetTokenV8Safe,
  flapScreenRequests,
} from "./flap.js";

describe("flap portal logs", () => {
  it("decodes TokenCreated from the unindexed ABI payload", () => {
    const token = "0x2222222222222222222222222222222222222222";
    const creator = "0x1111111111111111111111111111111111111111";
    const data = encodeCreated({ creator, token, name: "OKIE", symbol: "OK", meta: "bafy" });
    expect(decodePortalLog(TOPIC_TOKEN_CREATED, data)).toEqual({
      kind: "create",
      token,
      creator,
      name: "OKIE",
      symbol: "OK",
      meta: "bafy",
    });
  });

  it("decodes the tax, graduation, and ignores an unknown topic", () => {
    const token = "0x2222222222222222222222222222222222222222";
    const pool = "0x3333333333333333333333333333333333333333";
    expect(decodePortalLog(TOPIC_TAX_SET, words([addressWord(token), uintWord(150)]))).toEqual({
      kind: "tax",
      token,
      taxBps: 150,
    });
    expect(
      decodePortalLog(
        TOPIC_LAUNCHED_TO_DEX,
        words([addressWord(token), addressWord(pool), uintWord(1), uintWord(2)]),
      ),
    ).toEqual({ kind: "launch", token, pool });
    expect(decodePortalLog("0x" + "ab".repeat(32), "0x")).toBeNull();
  });

  it("reads buy and sell tax from getTokenV8Safe", () => {
    const words18 = Array.from({ length: 18 }, () => uintWord(0));
    words18[0] = uintWord(1);
    words18[9] = addressWord("0x0000000000000000000000000000000000000000");
    words18[12] = uintWord(100);
    words18[13] = uintWord(200);
    words18[14] = addressWord("0x4444444444444444444444444444444444444444");
    const state = decodeTokenStateV8(words(words18));
    expect(state).toEqual({
      status: 1,
      quoteToken: "0x0000000000000000000000000000000000000000",
      buyTaxBps: 100,
      sellTaxBps: 200,
      pool: "0x4444444444444444444444444444444444444444",
    });
    expect(encodeGetTokenV8Safe("0x2222222222222222222222222222222222222222")).toBe(
      "0x62fafcca" + "2222222222222222222222222222222222222222".padStart(64, "0"),
    );
  });

  it("builds screen requests and does not treat them as alerts", () => {
    const requests = flapScreenRequests("0xABCDEF");
    expect(requests.goplus).toContain("token_security/56");
    expect(requests.honeypot).toContain("chainID=56");
    expect(FLAP_LAUNCHPAD).toBe("Flap");
    expect(FLAP_PORTAL).toBe("0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0");
  });
});

function encodeCreated(input: {
  creator: string;
  token: string;
  name: string;
  symbol: string;
  meta: string;
}): string {
  const head = [uintWord(1), addressWord(input.creator), uintWord(7), addressWord(input.token)];
  const tail: string[] = [];
  for (const value of [input.name, input.symbol, input.meta]) {
    head.push(uintWord((7 + tail.length) * 32));
    tail.push(uintWord(value.length), utf8Word(value));
  }
  return words([...head, ...tail]);
}

function words(parts: string[]): string {
  return `0x${parts.join("")}`;
}

function uintWord(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function addressWord(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function utf8Word(value: string): string {
  return [...value]
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
}
