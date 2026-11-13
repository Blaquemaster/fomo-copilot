/**
 * Official Meteora program ids. Same address on mainnet and devnet.
 * DBC: https://docs.meteora.ag/developer-guides/dbc
 * DAMM v2: https://docs.meteora.ag/developer-guides/damm-v2
 * DLMM: https://docs.meteora.ag/developer-guides/dlmm
 *
 * IDL layouts (event and instruction discriminators below):
 * https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/src/idl/dynamic-bonding-curve/idl.json
 * https://github.com/MeteoraAg/damm-v2-sdk/blob/main/src/idl/cp_amm.json
 * https://github.com/MeteoraAg/dlmm-sdk/blob/main/idls/dlmm.json
 * IDL versions read from those files: DBC 0.2.2, DAMM v2 0.2.5, DLMM 0.12.0.
 */

export const DBC_PROGRAM_ID = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const DAMM_V2_PROGRAM_ID = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
export const DLMM_PROGRAM_ID = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

export const WATCHED_PROGRAMS = [DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID, DLMM_PROGRAM_ID] as const;

export type PoolType = "dbc" | "damm_v2" | "dlmm";

export type EventKind =
  | "dbc_initialize"
  | "dbc_curve_complete"
  | "dbc_migration_damm_v2"
  | "damm_v2_initialize"
  | "dlmm_initialize";

/** Quote mints the official DBC migration keeper treats as the quote side. */
export const QUOTE_MINTS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
  "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL",
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
  "3iQL8BFS2vE7mww4ehAqQHAsbmRNCrPxizWAT2Zfyr9y",
]);

export const TOKEN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

export const DISC = {
  dbcInitializePool: bytes(228, 50, 246, 85, 203, 66, 134, 37),
  dbcInitializePoolHook: bytes(213, 137, 164, 53, 193, 74, 15, 110),
  dbcCurveComplete: bytes(229, 231, 86, 84, 156, 134, 75, 24),
  dbcCurveCompleteHook: bytes(59, 47, 109, 205, 13, 31, 44, 159),
  dammInitializePool: bytes(228, 50, 246, 85, 203, 66, 134, 37),
  dlmmLbPairCreate: bytes(185, 74, 252, 125, 27, 215, 188, 111),
  ixDbcInitSpl: bytes(140, 85, 215, 176, 102, 54, 104, 79),
  ixDbcInitToken2022: bytes(169, 118, 51, 78, 145, 110, 220, 155),
  ixDbcInitToken2022Hook: bytes(182, 13, 233, 177, 42, 145, 135, 2),
  ixMigrationDammV2: bytes(156, 169, 230, 103, 53, 228, 80, 64),
  ixDammInitPool: bytes(95, 180, 10, 172, 84, 174, 232, 40),
  ixDammInitCustom: bytes(20, 161, 241, 24, 189, 221, 180, 2),
  ixDammInitDynamic: bytes(149, 82, 72, 197, 253, 252, 68, 15),
  ixDlmmInit: bytes(45, 154, 237, 210, 221, 15, 166, 92),
  ixDlmmInit2: bytes(73, 59, 36, 120, 237, 83, 108, 198),
  ixDlmmInitCustom: bytes(46, 39, 41, 135, 111, 183, 200, 64),
  ixDlmmInitCustom2: bytes(243, 73, 129, 126, 51, 19, 241, 107),
} as const;

/**
 * migration_damm_v2 account order from the DBC IDL.
 * https://docs.meteora.ag/developer-guides/dbc/program/instructions
 */
export const MIGRATION_DAMM_V2_ACCOUNTS = {
  virtualPool: 0,
  dammPool: 4,
  baseMint: 13,
  quoteMint: 14,
  payer: 19,
} as const;

/** Anchor `emit_cpi` instruction prefix. The event discriminator follows these 8 bytes. */
export const ANCHOR_EVENT_DISC = bytes(0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d);

export interface InstructionLayout {
  kind: EventKind;
  poolType: PoolType;
  pool: number;
  mintA: number;
  mintB: number | null;
  creator: number | null;
  virtualPool: number | null;
  quoteMint: number | null;
}

/** Account positions from the published IDLs. DBC inits share the same prefix. */
export const INSTRUCTION_LAYOUTS: ReadonlyArray<{
  programId: string;
  disc: Uint8Array;
  layout: InstructionLayout;
}> = [
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitSpl,
    layout: layout("dbc_initialize", "dbc", 5, 3, null, 2, null, 4),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitToken2022,
    layout: layout("dbc_initialize", "dbc", 5, 3, null, 2, null, 4),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitToken2022Hook,
    layout: layout("dbc_initialize", "dbc", 5, 3, null, 2, null, 4),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixMigrationDammV2,
    layout: layout("dbc_migration_damm_v2", "damm_v2", 4, 13, null, 19, 0, 14),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitCustom,
    layout: layout("damm_v2_initialize", "damm_v2", 5, 7, 8, 0, null, null),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitPool,
    layout: layout("damm_v2_initialize", "damm_v2", 6, 8, 9, 0, null, null),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitDynamic,
    layout: layout("damm_v2_initialize", "damm_v2", 7, 9, 10, 0, null, null),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInit,
    layout: layout("dlmm_initialize", "dlmm", 0, 2, 3, null, null, null),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInit2,
    layout: layout("dlmm_initialize", "dlmm", 0, 2, 3, null, null, null),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInitCustom,
    layout: layout("dlmm_initialize", "dlmm", 0, 2, 3, null, null, null),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInitCustom2,
    layout: layout("dlmm_initialize", "dlmm", 0, 2, 3, null, null, null),
  },
];

/**
 * Names sent to parsedTransactionSubscribe. Helius matches these
 * case- and separator-insensitively against its catalog.
 */
export const PARSED_INSTRUCTION_NAMES = [
  "initialize_virtual_pool_with_spl_token",
  "initialize_virtual_pool_with_token2022",
  "initialize_virtual_pool_with_token2022_transfer_hook",
  "migration_damm_v2",
  "initialize_pool",
  "initialize_customizable_pool",
  "initialize_pool_with_dynamic_config",
  "initialize_lb_pair",
  "initialize_lb_pair2",
  "initialize_customizable_permissionless_lb_pair",
  "initialize_customizable_permissionless_lb_pair2",
] as const;

function layout(
  kind: EventKind,
  poolType: PoolType,
  pool: number,
  mintA: number,
  mintB: number | null,
  creator: number | null,
  virtualPool: number | null,
  quoteMint: number | null,
): InstructionLayout {
  return { kind, poolType, pool, mintA, mintB, creator, virtualPool, quoteMint };
}

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.from(values);
}

export function sameDisc(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length < 8 || right.length < 8) return false;
  for (let i = 0; i < 8; i += 1) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}
