import { describe, expect, it } from "vitest";

import { encodeBase58 } from "./base58.js";
import {
  accountsByName,
  decodeProgramData,
  decodeRpcTransaction,
  observationsFromLogs,
  observationsFromTransaction,
  parseLogsNotification,
} from "./decode.js";
import {
  DBC_INIT_TOKEN2022_ACCOUNTS,
  DBC_INIT_TOKEN2022_HOOK_ACCOUNTS,
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM_ID,
  DISC,
  DLMM_PROGRAM_ID,
} from "./programs.js";

const CREATOR = pubkey(3);
const MINT = pubkey(4);
const POOL = pubkey(9);
const CONFIG = pubkey(2);

describe("DBC log fixtures", () => {
  it("decodes an EvtInitializePool program-data payload from the IDL layout", () => {
    const payload = Buffer.concat([
      Buffer.from(DISC.dbcInitializePool),
      Buffer.from(POOL),
      Buffer.from(CONFIG),
      Buffer.from(CREATOR),
      Buffer.from(MINT),
      Buffer.from([1]),
      u64(42n),
    ]).toString("base64");
    const logs = [
      `Program ${DBC_PROGRAM_ID} invoke [1]`,
      "Program log: Instruction: initialize_virtual_pool_with_spl_token",
      `Program data: ${payload}`,
      `Program ${DBC_PROGRAM_ID} success`,
    ];
    const found = observationsFromLogs({
      signature: "sig-init",
      slot: 10,
      logs,
      blockTimeMs: null,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      kind: "dbc_initialize",
      poolType: "dbc",
      mint: encodeBase58(MINT),
      pool: encodeBase58(POOL),
      creatorWallet: encodeBase58(CREATOR),
      signature: "sig-init",
      slot: 10,
    });
  });

  it("decodes EvtCurveComplete and ignores failed transactions", () => {
    const payload = Buffer.concat([
      Buffer.from(DISC.dbcCurveComplete),
      Buffer.from(POOL),
      Buffer.from(CONFIG),
      u64(1n),
      u64(2n),
    ]).toString("base64");
    const message = {
      method: "logsNotification",
      params: {
        result: {
          context: { slot: 11 },
          value: {
            signature: "sig-curve",
            err: null,
            logs: [
              `Program ${DBC_PROGRAM_ID} invoke [1]`,
              `Program data: ${payload}`,
              `Program ${DBC_PROGRAM_ID} success`,
            ],
          },
        },
      },
    };
    const frame = parseLogsNotification(message, 128);
    expect(frame?.observations[0]?.kind).toBe("dbc_curve_complete");
    expect(frame?.observations[0]?.pool).toBe(encodeBase58(POOL));
    const failed = structuredClone(message) as {
      params: { result: { value: { err: unknown } } };
    };
    failed.params.result.value.err = { InstructionError: [0, "Custom"] };
    expect(parseLogsNotification(failed, 128)).toBeNull();
  });

  it("reads migration_damm_v2 accounts from a recorded instruction layout", () => {
    const keys = Array.from({ length: 25 }, (_, index) => encodeBase58(pubkey(index + 1)));
    const data = encodeBase58(DISC.ixMigrationDammV2);
    const found = observationsFromTransaction({
      signature: "sig-migrate",
      slot: 12,
      blockTimeMs: 1_700_000_000_000,
      startIndex: 0,
      transaction: {
        message: {
          accountKeys: keys,
          instructions: [
            {
              programIdIndex:
                keys.indexOf(DBC_PROGRAM_ID) === -1 ? 0 : keys.indexOf(DBC_PROGRAM_ID),
              accounts: keys.map((_, index) => index),
              data,
            },
          ],
        },
        meta: { err: null, innerInstructions: [] },
      },
    });
    // The fixture's program id must be the DBC program. Put it at index 0 and point programIdIndex at it.
    keys[0] = DBC_PROGRAM_ID;
    const parsed = observationsFromTransaction({
      signature: "sig-migrate",
      slot: 12,
      blockTimeMs: 1_700_000_000_000,
      startIndex: 0,
      transaction: {
        message: {
          accountKeys: keys,
          instructions: [{ programIdIndex: 0, accounts: keys.map((_, index) => index), data }],
        },
        meta: { err: null },
      },
    });
    expect(found).toEqual([]);
    expect(parsed[0]).toMatchObject({
      kind: "dbc_migration_damm_v2",
      mint: keys[13],
      pool: keys[4],
      virtualPool: keys[0] === DBC_PROGRAM_ID ? keys[0] : keys[0],
      creatorWallet: keys[19],
    });
    expect(parsed[0]?.virtualPool).toBe(keys[0]);
  });

  it("decodes a DAMM v2 initialize event and a DLMM LbPairCreate event", () => {
    const damm = Buffer.concat([
      Buffer.from(DISC.dammInitializePool),
      Buffer.from(POOL),
      Buffer.from(MINT),
      Buffer.from(pubkey(7)),
      Buffer.from(CREATOR),
    ]).toString("base64");
    const dlmm = Buffer.concat([
      Buffer.from(DISC.dlmmLbPairCreate),
      Buffer.from(POOL),
      Buffer.from([8, 0]),
      Buffer.from(MINT),
      Buffer.from(pubkey(7)),
    ]).toString("base64");
    const dammFound = decodeProgramData(DAMM_V2_PROGRAM_ID, damm);
    const dlmmFound = decodeProgramData(DLMM_PROGRAM_ID, dlmm);
    expect(dammFound?.kind).toBe("damm_v2_initialize");
    expect(dammFound?.mint).toBe(encodeBase58(MINT));
    expect(dlmmFound?.kind).toBe("dlmm_initialize");
    expect(dlmmFound?.pool).toBe(encodeBase58(POOL));
  });
});

describe("named accounts", () => {
  it("reads the plain Token-2022 mint by the IDL name base_mint", () => {
    const accounts = DBC_INIT_TOKEN2022_ACCOUNTS.map((name) => `acct-${name}`);
    const named = accountsByName(DBC_INIT_TOKEN2022_ACCOUNTS, accounts);
    expect(named.get("base_mint")).toBe("acct-base_mint");
    expect(named.get("pool")).toBe("acct-pool");
    expect(named.has("transfer_hook_program")).toBe(false);
  });

  it("records a decode failure when a known instruction is missing its pool", () => {
    const decoded = decodeRpcTransaction(
      {
        slot: 5,
        blockTime: null,
        meta: { err: null, logMessages: [], innerInstructions: [] },
        transaction: {
          message: {
            accountKeys: [DBC_PROGRAM_ID, "only-one"],
            instructions: [
              {
                programIdIndex: 0,
                accounts: [1],
                data: encodeBase58(DISC.ixDbcInitToken2022),
              },
            ],
          },
        },
      },
      "sig-fail",
    );
    expect(decoded.observations).toEqual([]);
    expect(decoded.failures).toEqual([
      {
        signature: "sig-fail",
        slot: 5,
        programId: DBC_PROGRAM_ID,
        instructionName: "initialize_virtual_pool_with_token2022",
        error: "missing account pool",
      },
    ]);
    expect(DBC_INIT_TOKEN2022_HOOK_ACCOUNTS).toContain("transfer_hook_program");
  });
});

function pubkey(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function u64(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUint64LE(value);
  return out;
}
