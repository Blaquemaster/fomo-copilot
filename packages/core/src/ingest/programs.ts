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
  /** sha256("global:swap")[..8], and the swap2 variants. Used to read base_mint, not stored. */
  ixDbcSwap: bytes(248, 198, 158, 145, 225, 117, 135, 200),
  ixDbcSwap2: bytes(65, 75, 63, 76, 235, 91, 91, 136),
  ixDbcSwap2Hook: bytes(183, 93, 153, 40, 24, 230, 194, 151),
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
  /** IDL account names in instruction order. Fields below are these names, not indexes. */
  accountNames: readonly string[];
  instructionName: string;
  pool: string;
  mintA: string;
  mintB: string | null;
  creator: string | null;
  virtualPool: string | null;
  quoteMint: string | null;
}

/** IDL account order. DBC 0.2.2 initialize_virtual_pool_with_spl_token. */
export const DBC_INIT_SPL_ACCOUNTS = [
  "config",
  "pool_authority",
  "creator",
  "base_mint",
  "quote_mint",
  "pool",
  "base_vault",
  "quote_vault",
  "mint_metadata",
  "metadata_program",
  "payer",
  "token_quote_program",
  "token_program",
  "system_program",
  "event_authority",
  "program",
] as const;

/** initialize_virtual_pool_with_token2022. base_mint and pool stay at the same names. */
export const DBC_INIT_TOKEN2022_ACCOUNTS = [
  "config",
  "pool_authority",
  "creator",
  "base_mint",
  "quote_mint",
  "pool",
  "base_vault",
  "quote_vault",
  "payer",
  "token_quote_program",
  "token_program",
  "system_program",
  "event_authority",
  "program",
] as const;

/** initialize_virtual_pool_with_token2022_transfer_hook adds transfer_hook_program. */
export const DBC_INIT_TOKEN2022_HOOK_ACCOUNTS = [
  "config",
  "pool_authority",
  "creator",
  "base_mint",
  "quote_mint",
  "pool",
  "base_vault",
  "quote_vault",
  "transfer_hook_program",
  "payer",
  "token_quote_program",
  "token_program",
  "system_program",
  "event_authority",
  "program",
] as const;

export const DBC_MIGRATION_DAMM_V2_ACCOUNTS = [
  "virtual_pool",
  "migration_metadata",
  "config",
  "pool_authority",
  "pool",
  "first_position_nft_mint",
  "first_position_nft_account",
  "first_position",
  "second_position_nft_mint",
  "second_position_nft_account",
  "second_position",
  "damm_pool_authority",
  "amm_program",
  "base_mint",
  "quote_mint",
  "token_a_vault",
  "token_b_vault",
  "base_vault",
  "quote_vault",
  "payer",
  "token_base_program",
  "token_quote_program",
  "token_2022_program",
  "damm_event_authority",
  "system_program",
] as const;

/** swap / swap2 / swap2_with_transfer_hook. base_mint is how a curve-complete event gets a mint. */
export const DBC_SWAP_ACCOUNTS = [
  "pool_authority",
  "config",
  "pool",
  "input_token_account",
  "output_token_account",
  "base_vault",
  "quote_vault",
  "base_mint",
  "quote_mint",
  "payer",
  "token_base_program",
  "token_quote_program",
  "referral_token_account",
  "event_authority",
  "program",
] as const;

export const DAMM_INIT_CUSTOM_ACCOUNTS = [
  "creator",
  "position_nft_mint",
  "position_nft_account",
  "payer",
  "pool_authority",
  "pool",
  "position",
  "token_a_mint",
  "token_b_mint",
  "token_a_vault",
  "token_b_vault",
  "payer_token_a",
  "payer_token_b",
  "token_a_program",
  "token_b_program",
  "token_2022_program",
  "system_program",
  "event_authority",
  "program",
] as const;

export const DAMM_INIT_POOL_ACCOUNTS = [
  "creator",
  "position_nft_mint",
  "position_nft_account",
  "payer",
  "config",
  "pool_authority",
  "pool",
  "position",
  "token_a_mint",
  "token_b_mint",
  "token_a_vault",
  "token_b_vault",
  "payer_token_a",
  "payer_token_b",
  "token_a_program",
  "token_b_program",
  "token_2022_program",
  "system_program",
  "event_authority",
  "program",
] as const;

export const DAMM_INIT_DYNAMIC_ACCOUNTS = [
  "creator",
  "position_nft_mint",
  "position_nft_account",
  "payer",
  "pool_creator_authority",
  "config",
  "pool_authority",
  "pool",
  "position",
  "token_a_mint",
  "token_b_mint",
  "token_a_vault",
  "token_b_vault",
  "payer_token_a",
  "payer_token_b",
  "token_a_program",
  "token_b_program",
  "token_2022_program",
  "system_program",
  "event_authority",
  "program",
] as const;

export const DLMM_INIT_ACCOUNTS = [
  "lb_pair",
  "bin_array_bitmap_extension",
  "token_mint_x",
  "token_mint_y",
  "reserve_x",
  "reserve_y",
  "oracle",
  "preset_parameter",
  "funder",
  "token_program",
  "system_program",
  "rent",
  "event_authority",
  "program",
] as const;

export const DLMM_INIT2_ACCOUNTS = [
  "lb_pair",
  "bin_array_bitmap_extension",
  "token_mint_x",
  "token_mint_y",
  "reserve_x",
  "reserve_y",
  "oracle",
  "preset_parameter",
  "funder",
  "token_badge_x",
  "token_badge_y",
  "token_program_x",
  "token_program_y",
  "system_program",
  "event_authority",
  "program",
] as const;

export const DLMM_INIT_CUSTOM_ACCOUNTS = [
  "lb_pair",
  "bin_array_bitmap_extension",
  "token_mint_x",
  "token_mint_y",
  "reserve_x",
  "reserve_y",
  "oracle",
  "user_token_x",
  "funder",
  "token_program",
  "system_program",
  "user_token_y",
  "event_authority",
  "program",
] as const;

export const DLMM_INIT_CUSTOM2_ACCOUNTS = [
  "lb_pair",
  "bin_array_bitmap_extension",
  "token_mint_x",
  "token_mint_y",
  "reserve_x",
  "reserve_y",
  "oracle",
  "user_token_x",
  "funder",
  "token_badge_x",
  "token_badge_y",
  "token_program_x",
  "token_program_y",
  "system_program",
  "user_token_y",
  "event_authority",
  "program",
] as const;

/** Account names from the published IDLs. Extraction is by name, not by a bare index. */
export const INSTRUCTION_LAYOUTS: ReadonlyArray<{
  programId: string;
  disc: Uint8Array;
  layout: InstructionLayout;
}> = [
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitSpl,
    layout: layout(
      "dbc_initialize",
      "dbc",
      DBC_INIT_SPL_ACCOUNTS,
      "initialize_virtual_pool_with_spl_token",
      "pool",
      "base_mint",
      null,
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitToken2022,
    layout: layout(
      "dbc_initialize",
      "dbc",
      DBC_INIT_TOKEN2022_ACCOUNTS,
      "initialize_virtual_pool_with_token2022",
      "pool",
      "base_mint",
      null,
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcInitToken2022Hook,
    layout: layout(
      "dbc_initialize",
      "dbc",
      DBC_INIT_TOKEN2022_HOOK_ACCOUNTS,
      "initialize_virtual_pool_with_token2022_transfer_hook",
      "pool",
      "base_mint",
      null,
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixMigrationDammV2,
    layout: layout(
      "dbc_migration_damm_v2",
      "damm_v2",
      DBC_MIGRATION_DAMM_V2_ACCOUNTS,
      "migration_damm_v2",
      "pool",
      "base_mint",
      null,
      "payer",
      "virtual_pool",
      "quote_mint",
    ),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitCustom,
    layout: layout(
      "damm_v2_initialize",
      "damm_v2",
      DAMM_INIT_CUSTOM_ACCOUNTS,
      "initialize_customizable_pool",
      "pool",
      "token_a_mint",
      "token_b_mint",
      "creator",
      null,
      null,
    ),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitPool,
    layout: layout(
      "damm_v2_initialize",
      "damm_v2",
      DAMM_INIT_POOL_ACCOUNTS,
      "initialize_pool",
      "pool",
      "token_a_mint",
      "token_b_mint",
      "creator",
      null,
      null,
    ),
  },
  {
    programId: DAMM_V2_PROGRAM_ID,
    disc: DISC.ixDammInitDynamic,
    layout: layout(
      "damm_v2_initialize",
      "damm_v2",
      DAMM_INIT_DYNAMIC_ACCOUNTS,
      "initialize_pool_with_dynamic_config",
      "pool",
      "token_a_mint",
      "token_b_mint",
      "creator",
      null,
      null,
    ),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInit,
    layout: layout(
      "dlmm_initialize",
      "dlmm",
      DLMM_INIT_ACCOUNTS,
      "initialize_lb_pair",
      "lb_pair",
      "token_mint_x",
      "token_mint_y",
      null,
      null,
      null,
    ),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInit2,
    layout: layout(
      "dlmm_initialize",
      "dlmm",
      DLMM_INIT2_ACCOUNTS,
      "initialize_lb_pair2",
      "lb_pair",
      "token_mint_x",
      "token_mint_y",
      null,
      null,
      null,
    ),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInitCustom,
    layout: layout(
      "dlmm_initialize",
      "dlmm",
      DLMM_INIT_CUSTOM_ACCOUNTS,
      "initialize_customizable_permissionless_lb_pair",
      "lb_pair",
      "token_mint_x",
      "token_mint_y",
      null,
      null,
      null,
    ),
  },
  {
    programId: DLMM_PROGRAM_ID,
    disc: DISC.ixDlmmInitCustom2,
    layout: layout(
      "dlmm_initialize",
      "dlmm",
      DLMM_INIT_CUSTOM2_ACCOUNTS,
      "initialize_customizable_permissionless_lb_pair2",
      "lb_pair",
      "token_mint_x",
      "token_mint_y",
      null,
      null,
      null,
    ),
  },
];

export const SWAP_LAYOUTS: ReadonlyArray<{
  programId: string;
  disc: Uint8Array;
  accountNames: readonly string[];
  instructionName: string;
}> = [
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcSwap,
    accountNames: DBC_SWAP_ACCOUNTS,
    instructionName: "swap",
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcSwap2,
    accountNames: DBC_SWAP_ACCOUNTS,
    instructionName: "swap2",
  },
  {
    programId: DBC_PROGRAM_ID,
    disc: DISC.ixDbcSwap2Hook,
    accountNames: DBC_SWAP_ACCOUNTS,
    instructionName: "swap2_with_transfer_hook",
  },
];

/**
 * Names sent to parsedTransactionSubscribe. Helius matches these
 * case- and separator-insensitively against its catalog.
 */
export const DBC_PARSED_INSTRUCTION_NAMES = [
  "initialize_virtual_pool_with_spl_token",
  "initialize_virtual_pool_with_token2022",
  "initialize_virtual_pool_with_token2022_transfer_hook",
  "migration_damm_v2",
] as const;

export const DAMM_PARSED_INSTRUCTION_NAMES = [
  "initialize_pool",
  "initialize_customizable_pool",
  "initialize_pool_with_dynamic_config",
] as const;

export const DLMM_PARSED_INSTRUCTION_NAMES = [
  "initialize_lb_pair",
  "initialize_lb_pair2",
  "initialize_customizable_permissionless_lb_pair",
  "initialize_customizable_permissionless_lb_pair2",
] as const;

export const PARSED_INSTRUCTION_NAMES = [
  ...DBC_PARSED_INSTRUCTION_NAMES,
  ...DAMM_PARSED_INSTRUCTION_NAMES,
  ...DLMM_PARSED_INSTRUCTION_NAMES,
] as const;

/** DAMM v2 and DLMM list mostly swaps. Startup backfill scans these by instruction name. */
export const HIGH_VOLUME_PROGRAM_IDS = [DAMM_V2_PROGRAM_ID, DLMM_PROGRAM_ID] as const;

export function parsedNamesForProgram(programId: string): readonly string[] {
  if (programId === DBC_PROGRAM_ID) return DBC_PARSED_INSTRUCTION_NAMES;
  if (programId === DAMM_V2_PROGRAM_ID) return DAMM_PARSED_INSTRUCTION_NAMES;
  if (programId === DLMM_PROGRAM_ID) return DLMM_PARSED_INSTRUCTION_NAMES;
  return [];
}

export function isHighVolumeProgram(programId: string): boolean {
  return (HIGH_VOLUME_PROGRAM_IDS as readonly string[]).includes(programId);
}

function layout(
  kind: EventKind,
  poolType: PoolType,
  accountNames: readonly string[],
  instructionName: string,
  pool: string,
  mintA: string,
  mintB: string | null,
  creator: string | null,
  virtualPool: string | null,
  quoteMint: string | null,
): InstructionLayout {
  return {
    kind,
    poolType,
    accountNames,
    instructionName,
    pool,
    mintA,
    mintB,
    creator,
    virtualPool,
    quoteMint,
  };
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
