import { describe, expect, it } from "vitest";

import { PERMISSIONS_APPLIED, PERMISSION_MAP } from "./permissions.js";

describe("permission map", () => {
  it("gives the signer no database login and does not claim the roles are applied", () => {
    expect(PERMISSIONS_APPLIED).toBe(false);
    const signer = PERMISSION_MAP.find((row) => row.process === "signer");
    expect(signer?.role).toBeNull();
    const exec = PERMISSION_MAP.find((row) => row.process === "execution-records");
    expect(exec && "appendOnly" in exec && exec.appendOnly).toBe(true);
    expect(exec?.writes).toContain("autobuy_intent");
  });
});
