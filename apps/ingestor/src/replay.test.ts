import { describe, expect, it } from "vitest";

import { assertSchema, parseReplayArgs } from "./replay.js";

describe("replay arguments", () => {
  it("parses the historical window and refuses the live schema", () => {
    expect(
      parseReplayArgs([
        "--from-slot",
        "468993762",
        "--to-slot",
        "468993810",
        "--programs",
        "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
        "--schema",
        "scratch_replay",
        "--credit-cap",
        "150",
      ]),
    ).toEqual({
      fromSlot: 468993762,
      toSlot: 468993810,
      programs: ["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"],
      schema: "scratch_replay",
      creditCap: 150,
      before: null,
      until: null,
      anchorSignature: null,
    });
    expect(
      parseReplayArgs([
        "--from-slot",
        "468993762",
        "--to-slot",
        "468993810",
        "--programs",
        "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
        "--anchor-signature",
        "5".repeat(64).replaceAll("5", "2"),
      ]).anchorSignature,
    ).toHaveLength(64);
    expect(assertSchema("scratch_replay")).toBe("scratch_replay");
    expect(() => assertSchema("public")).toThrow(/live schema/);
    expect(() =>
      parseReplayArgs([
        "--schema",
        "public",
        "--from-slot",
        "1",
        "--to-slot",
        "2",
        "--programs",
        "abc",
      ]),
    ).toThrow(/live schema/);
  });
});
