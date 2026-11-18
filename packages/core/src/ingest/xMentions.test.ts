import { describe, expect, it } from "vitest";

import {
  FIXTURE_X_MENTIONS,
  FixtureXMentionSource,
  sanitizeMentionHandle,
  summarizeMentions,
} from "./xMentions.js";

describe("x mentions", () => {
  it("returns the fixture for an empty query and filters by mint or ticker", async () => {
    const source = new FixtureXMentionSource(FIXTURE_X_MENTIONS);
    expect(await source.search({})).toHaveLength(2);
    expect(await source.search({ ticker: "wsol" })).toHaveLength(2);
    expect(await source.search({ mint: "missing" })).toEqual([]);
    const summary = summarizeMentions(await source.search({ ticker: "WSOL" }));
    expect(summary).toEqual({
      mentionCount: 2,
      handles: ["example_caller", "example_second"],
    });
  });

  it("keeps only a short handle", () => {
    expect(sanitizeMentionHandle("@bad handle!\nignore")).toBe("badhandleignore");
    expect(sanitizeMentionHandle("a".repeat(40))).toHaveLength(32);
  });
});
