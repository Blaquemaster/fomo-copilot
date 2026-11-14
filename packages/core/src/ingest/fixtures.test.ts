import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  decodeRpcTransaction,
  isPersistable,
  normalizeInstructionName,
  parseParsedNotification,
  parseRpcTransaction,
} from "./decode.js";
import type { Observation } from "./decode.js";
import { PARSED_INSTRUCTION_NAMES } from "./programs.js";

const MIGRATION_MINT = "4MKCDXiCASBmZLJrTq6J9usjPXZ8mCsPZFcR7QGdpump";
const MIGRATION_POOL = "5uPyUS4ZW8KJFTb94bw7DhBgrWW29v8ekL6czSbWud3f";

describe("mainnet transaction fixtures", () => {
  it("reads mint and pool from the recorded migration and DAMM v2 initializes", () => {
    const migration = load("migration.json");
    const migrationObs = parseRpcTransaction(migration.result, migration.signature);
    expect(migrationObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dbc_migration_damm_v2",
          mint: MIGRATION_MINT,
          pool: MIGRATION_POOL,
        }),
      ]),
    );
    expect(migrationObs.every(isPersistable)).toBe(true);

    const first = load("damm-init-1.json");
    const firstObs = parseRpcTransaction(first.result, first.signature);
    expect(firstObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "damm_v2_initialize",
          pool: "G3xtgELLfYjrEWL9YLbkwPkVsyfYyCA5ZEhQto9mi3UY",
          mint: "12nka8TPeojAYcUnEWzGnVj2Pj5N1aqgR92b6qeZnQgL",
        }),
      ]),
    );

    const second = load("damm-init-2.json");
    const secondObs = parseRpcTransaction(second.result, second.signature);
    expect(secondObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "damm_v2_initialize",
          pool: "J9JNpsMrxm9NXd2NrUNMhqqUZt4KfveA25y9JiaNkywm",
          mint: "EgjqZNNbSJJPQSUEg681dz7m2xMBsbwvpeT4i7bypump",
        }),
      ]),
    );
  });

  it("decodes the missed transfer-hook initializes from the replay fixtures", () => {
    const filterName = PARSED_INSTRUCTION_NAMES.find((name) => name.includes("transfer_hook"));
    expect(filterName).toBe("initialize_virtual_pool_with_token2022_transfer_hook");
    expect(normalizeInstructionName("InitializeVirtualPoolWithToken2022TransferHook")).toBe(
      normalizeInstructionName(filterName ?? ""),
    );

    const first = load("dbc-hook-1.json");
    const firstObs = parseRpcTransaction(first.result, first.signature);
    expect(firstObs).toEqual([
      expect.objectContaining({
        kind: "dbc_initialize",
        mint: "9V1axz9mB2X45pUXCP9iYBVGsegU643eqvnJkuC2936x",
        pool: "4M3t9sK7LxgNswQJsWVr9RArw3pkrGgt5hay4D84CPX4",
        creatorWallet: "HJ7EQQu9GKatKLHhMyhmyTSDkiAMQ8BBy63QFZNWcDhu",
        quoteMint: "So11111111111111111111111111111111111111112",
        slot: 468993762,
      }),
    ]);

    const second = load("dbc-hook-2.json");
    const secondObs = parseRpcTransaction(second.result, second.signature);
    expect(secondObs).toEqual([
      expect.objectContaining({
        kind: "dbc_initialize",
        mint: "41ivq87Ztap2dFoUoNkfNqDoajvNZBc5GpeQTwPyBNCs",
        pool: "WUqXid1GYDsSddSfwxCUkuH7H4a9n51zZkeSRCcimdS",
        creatorWallet: "3WKGFH6torEhV6aSMuzyPW6jqzyoVeEB7gv7vVBMhVyK",
        quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        slot: 468993810,
      }),
    ]);
    expect(secondObs.every(isPersistable)).toBe(true);
  });

  it("keeps a plain Token-2022 mint and fills dbc_curve_complete from the swap base_mint", () => {
    const first = load("dbc-curve-1.json");
    const firstObs = parseRpcTransaction(first.result, first.signature);
    expect(firstObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dbc_initialize",
          mint: "D84UUjZSwEkXCncDrG1nN5Y3iqPmcViqjuXaX8xSwxZW",
          pool: "DrDze9nM9Fu6zYcburHH4jx31N3DbdisKY2HpDR9bg2k",
        }),
        expect.objectContaining({
          kind: "dbc_curve_complete",
          mint: "D84UUjZSwEkXCncDrG1nN5Y3iqPmcViqjuXaX8xSwxZW",
          pool: "DrDze9nM9Fu6zYcburHH4jx31N3DbdisKY2HpDR9bg2k",
        }),
      ]),
    );

    const second = load("dbc-curve-2.json");
    const secondObs = parseRpcTransaction(second.result, second.signature);
    expect(secondObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "dbc_curve_complete",
          mint: "H5Y83QAiJu3p8aWerLm7UM4oucXDmuExXHMKwjc2pY8x",
          pool: "4e6CMxfXM7cGFaCqdBHNUUpfKmfjRgA7wfQkkNUQnVmn",
        }),
      ]),
    );
    expect(secondObs.every(isPersistable)).toBe(true);
    const decoded = decodeRpcTransaction(second.result, second.signature);
    expect(decoded.failures).toEqual([]);
  });

  it("does not keep an initialize that never resolved a mint and pool", () => {
    const blank: Observation = {
      signature: "sig",
      slot: 1,
      programId: "program",
      eventIndex: 0,
      kind: "dbc_initialize",
      poolType: "dbc",
      mint: null,
      pool: null,
      creatorWallet: null,
      virtualPool: null,
      quoteMint: null,
      blockTimeMs: null,
    };
    expect(isPersistable(blank)).toBe(false);
  });

  it("reads named accounts from a parsedTransactionNotification", () => {
    const frame = parseParsedNotification(
      {
        method: "parsedTransactionNotification",
        params: {
          result: {
            context: { slot: 99 },
            value: {
              transaction: {
                signature: "sig-parsed",
                slot: 99,
                error: null,
                blockTime: 1700000000,
              },
              instructions: [
                {
                  programId: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
                  instructionName: "initialize_virtual_pool_with_spl_token",
                  decoded: {
                    accounts: [
                      { name: "creator", pubkey: "creator-wallet" },
                      { name: "base_mint", pubkey: "base-mint" },
                      { name: "quote_mint", pubkey: "So11111111111111111111111111111111111111112" },
                      { name: "pool", pubkey: "dbc-pool" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      400,
    );
    expect(frame?.observations).toEqual([
      expect.objectContaining({
        kind: "dbc_initialize",
        mint: "base-mint",
        pool: "dbc-pool",
        creatorWallet: "creator-wallet",
      }),
    ]);
  });
});

function load(name: string): { signature: string; result: unknown } {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")) as {
    signature: string;
    result: unknown;
  };
}
