import { describe, expect, it } from "vitest";

import { placeSwap } from "./swapClient.js";

describe("swap client", () => {
  it("names the order and execute requests and does not send them", () => {
    const placed = placeSwap({ mint: "mint-a", amount: 5 });
    expect(placed.sent).toBe(false);
    expect(placed.reason).toBe("submission_boundary_held");
    expect(placed.order.url).toContain("https://api.jup.ag/swap/v2/order");
    expect(placed.execute.url).toBe("https://api.jup.ag/swap/v2/execute");
    expect(placed.order.body).toBeNull();
  });
});
