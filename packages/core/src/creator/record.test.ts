import { describe, expect, it } from "vitest";

import { creatorRecord } from "./record.js";

describe("creator record", () => {
  it("stores a shared funder without calling it common control", () => {
    const record = creatorRecord({
      creator: "creator-a",
      holdings: ["mint-a"],
      sales: ["mint-b"],
      launches: ["mint-a", "mint-c"],
      sharedFunderWith: ["wallet-b"],
    });
    expect(record.relationships[0]).toEqual({
      creator: "creator-a",
      other: "wallet-b",
      evidence: "shared_funder",
      commonControl: false,
    });
  });
});
