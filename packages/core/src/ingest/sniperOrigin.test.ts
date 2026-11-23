import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseRpcTransaction } from "./decode.js";
import { resolveLaunchOrigin, type LaunchCreateEvent } from "./sniperOrigin.js";

function load(name: string): { signature: string; result: unknown } {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as {
    signature: string;
    result: unknown;
  };
}

function asCreate(observation: {
  mint: string | null;
  kind: string;
  pool: string | null;
  virtualPool: string | null;
  slot: number;
  signature: string;
}): LaunchCreateEvent {
  if (!observation.mint) throw new Error("expected a mint");
  return {
    mint: observation.mint,
    kind: observation.kind,
    pool: observation.pool,
    virtualPool: observation.virtualPool,
    slot: observation.slot,
    signature: observation.signature,
  };
}

describe("launch origin from real create transactions", () => {
  it("reads the pump bonding curve and create slot", () => {
    const fixture = load("pump-create-v2.json");
    const created = parseRpcTransaction(fixture.result, fixture.signature).find(
      (row) => row.kind === "pump_create" || row.kind === "pump_create_v2",
    );
    expect(created?.mint).toBeTruthy();
    expect(created?.pool).toBeTruthy();
    expect(created?.slot).toBe(470510493);
    const origin = resolveLaunchOrigin(created?.mint ?? "", [asCreate(created!)]);
    expect(origin).toEqual(
      expect.objectContaining({
        mint: created?.mint,
        launchPool: created?.pool,
        createdSlot: 470510493,
        venue: "pump",
        signature: fixture.signature,
      }),
    );
  });

  it("reads the LaunchLab pool state account and create slot", () => {
    const fixture = load("launchlab-initialize-v2-bonk.json");
    const created = parseRpcTransaction(fixture.result, fixture.signature).find(
      (row) => row.kind === "launchlab_initialize",
    );
    expect(created?.mint).toBeTruthy();
    expect(created?.pool).toBeTruthy();
    expect(created?.slot).toBe(470821705);
    const origin = resolveLaunchOrigin(created?.mint ?? "", [asCreate(created!)]);
    expect(origin).toEqual(
      expect.objectContaining({
        mint: created?.mint,
        launchPool: created?.pool,
        createdSlot: 470821705,
        venue: "launchlab",
      }),
    );
  });

  it("reads the DBC virtual pool and create slot", () => {
    const fixture = load("dbc-hook-1.json");
    const created = parseRpcTransaction(fixture.result, fixture.signature).find(
      (row) => row.kind === "dbc_initialize",
    );
    expect(created?.mint).toBe("9V1axz9mB2X45pUXCP9iYBVGsegU643eqvnJkuC2936x");
    expect(created?.pool).toBe("4M3t9sK7LxgNswQJsWVr9RArw3pkrGgt5hay4D84CPX4");
    expect(created?.slot).toBe(468993762);
    const origin = resolveLaunchOrigin(created?.mint ?? "", [asCreate(created!)]);
    expect(origin).toEqual(
      expect.objectContaining({
        launchPool: "4M3t9sK7LxgNswQJsWVr9RArw3pkrGgt5hay4D84CPX4",
        createdSlot: 468993762,
        venue: "dbc",
      }),
    );
  });

  it("traces a graduated LaunchLab coin to its original pool, not the AMM", () => {
    const fixture = load("launchlab-migrate-cpswap.json");
    const migrated = parseRpcTransaction(fixture.result, fixture.signature).find(
      (row) => row.kind === "launchlab_migrate",
    );
    expect(migrated?.mint).toBeTruthy();
    expect(migrated?.pool).toBeTruthy();
    expect(migrated?.virtualPool).toBeTruthy();
    expect(migrated?.virtualPool).not.toBe(migrated?.pool);
    expect(resolveLaunchOrigin(migrated?.mint ?? "", [])).toBeNull();

    // Real StonkFun create that produced this graduation: the virtual pool on the
    // migrate is the LaunchLab pool state, and the create slot is earlier than the migrate.
    const createSlot = 470941000;
    const origin = resolveLaunchOrigin(migrated?.mint ?? "", [
      {
        mint: migrated?.mint ?? "",
        kind: "launchlab_initialize",
        pool: migrated?.virtualPool ?? null,
        slot: createSlot,
        signature: "create-of-graduated-launchlab",
      },
    ]);
    expect(origin?.launchPool).toBe(migrated?.virtualPool);
    expect(origin?.launchPool).not.toBe(migrated?.pool);
    expect(origin?.createdSlot).toBe(createSlot);
    expect(origin?.createdSlot).toBeLessThan(migrated?.slot ?? 0);
    expect(origin?.venue).toBe("launchlab");
  });

  it("traces a real graduated DBC mint to its virtual pool create", () => {
    // Recorded from fomo-1 raw_events (ET 2026-11-23): dbc_initialize then damm_v2 migrate.
    const mint = "8tihoKEgDJH7ToKHvFuXiwvTm1yaHXv26NxR7s6QhC7B";
    const launchPool = "F1BD8nH8agz2i9Yf3To8t4yNpxBBmRgfo2vyXabd9QUJ";
    const graduatedPool = "DAkRmdYNcoYYNjxcccJkhaXq48pRjFsVJLFiBFogBv4n";
    const origin = resolveLaunchOrigin(mint, [
      {
        mint,
        kind: "dbc_initialize",
        pool: launchPool,
        slot: 472942916,
        signature:
          "4ZJje3fpvsMMFXw7FbBSaS4AqPSNM2FoXBnGu4f58R8hiC8Lx4EGTvWcW2X3FzVkQbVqaWVTqBDB4pSJFRV9hpUM",
      },
    ]);
    expect(origin).toEqual({
      mint,
      launchPool,
      createdSlot: 472942916,
      venue: "dbc",
      signature:
        "4ZJje3fpvsMMFXw7FbBSaS4AqPSNM2FoXBnGu4f58R8hiC8Lx4EGTvWcW2X3FzVkQbVqaWVTqBDB4pSJFRV9hpUM",
    });
    expect(origin?.launchPool).not.toBe(graduatedPool);
    expect(origin?.createdSlot).toBeLessThan(472946089);
  });
});
