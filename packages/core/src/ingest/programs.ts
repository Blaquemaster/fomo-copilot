import { ConfigError } from "../config/error.js";

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

/**
 * Official Pump.fun program. IDL address field:
 * https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
 */
export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";

/**
 * Official PumpSwap (pump_amm) program. IDL address field:
 * https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump_amm.json
 */
export const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

/**
 * Raydium LaunchLab. IDL address field, raydium_launchpad 0.2.0:
 * https://github.com/raydium-io/raydium-idl/blob/master/raydium_launchpad/raydium_launchpad.json
 */
export const LAUNCHLAB_PROGRAM_ID = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";

export const WATCHED_PROGRAMS = [DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID, DLMM_PROGRAM_ID] as const;

export const PUMP_PROGRAMS = [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID] as const;

/** DBC launches and DAMM v2 migrations. DLMM is not a launchpad and stays off the socket. */
export const METEORA_LAUNCH_PROGRAMS = [DBC_PROGRAM_ID, DAMM_V2_PROGRAM_ID] as const;

export const LAUNCHLAB_PROGRAMS = [LAUNCHLAB_PROGRAM_ID] as const;

export type IngestVenue = "pump" | "launchlab" | "meteora";

export type PoolType = "dbc" | "damm_v2" | "dlmm" | "pump" | "pumpswap" | "launchlab";

export type EventKind =
  | "dbc_initialize"
  | "dbc_curve_complete"
  | "dbc_migration_damm_v2"
  | "damm_v2_initialize"
  | "dlmm_initialize"
  | "pump_create"
  | "pump_create_v2"
  | "pump_buy"
  | "pump_sell"
  | "pump_migrate"
  | "pumpswap_create_pool"
  | "pumpswap_buy"
  | "pumpswap_sell"
  | "launchlab_initialize"
  | "launchlab_migrate";

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
  /** sha256("global:<name>")[..8] from idl/pump.json and idl/pump_amm.json. */
  ixPumpCreate: bytes(24, 30, 200, 40, 5, 28, 7, 119),
  ixPumpCreateV2: bytes(214, 144, 76, 236, 95, 139, 49, 180),
  ixPumpBuy: bytes(102, 6, 61, 18, 1, 218, 235, 234),
  ixPumpBuyV2: bytes(184, 23, 238, 97, 103, 197, 211, 61),
  ixPumpSell: bytes(51, 230, 133, 164, 1, 127, 131, 173),
  ixPumpMigrate: bytes(155, 234, 231, 146, 236, 158, 162, 30),
  ixPumpMigrateV2: bytes(187, 203, 18, 31, 206, 237, 254, 41),
  ixPumpAmmCreatePool: bytes(233, 146, 209, 142, 207, 104, 64, 188),
  ixPumpAmmBuy: bytes(102, 6, 61, 18, 1, 218, 235, 234),
  ixPumpAmmBuyV2: bytes(184, 23, 238, 97, 103, 197, 211, 61),
  ixPumpAmmSell: bytes(51, 230, 133, 164, 1, 127, 131, 173),
  ixPumpAmmSellV2: bytes(93, 246, 130, 60, 231, 233, 64, 178),
  /** sha256("global:<name>")[..8] from raydium_launchpad.json 0.2.0. */
  ixLaunchlabInitialize: bytes(175, 175, 109, 31, 13, 152, 155, 237),
  ixLaunchlabInitializeV2: bytes(67, 153, 175, 39, 218, 16, 38, 32),
  ixLaunchlabInitializeToken2022: bytes(37, 190, 126, 222, 44, 154, 171, 17),
  ixLaunchlabMigrateAmm: bytes(207, 82, 192, 145, 254, 207, 145, 223),
  ixLaunchlabMigrateCpswap: bytes(136, 92, 200, 103, 28, 218, 144, 140),
} as const;

/** initialize and initialize_v2 share this account order. */
export const LAUNCHLAB_INIT_ACCOUNTS = [
  "payer",
  "creator",
  "global_config",
  "platform_config",
  "authority",
  "pool_state",
  "base_mint",
  "quote_mint",
  "base_vault",
  "quote_vault",
  "metadata_account",
  "base_token_program",
  "quote_token_program",
  "metadata_program",
  "system_program",
  "rent_program",
  "event_authority",
  "program",
] as const;

/** initialize_with_token_2022 drops the metadata accounts. */
export const LAUNCHLAB_INIT_TOKEN2022_ACCOUNTS = [
  "payer",
  "creator",
  "global_config",
  "platform_config",
  "authority",
  "pool_state",
  "base_mint",
  "quote_mint",
  "base_vault",
  "quote_vault",
  "base_token_program",
  "quote_token_program",
  "system_program",
  "event_authority",
  "program",
] as const;

export const LAUNCHLAB_MIGRATE_CPSWAP_ACCOUNTS = [
  "payer",
  "base_mint",
  "quote_mint",
  "platform_config",
  "cpswap_program",
  "cpswap_pool",
  "cpswap_authority",
  "cpswap_lp_mint",
  "cpswap_base_vault",
  "cpswap_quote_vault",
  "cpswap_config",
  "cpswap_create_pool_fee",
  "cpswap_observation",
  "lock_program",
  "lock_authority",
  "lock_lp_vault",
  "authority",
  "pool_state",
  "global_config",
  "base_vault",
  "quote_vault",
  "pool_lp_token",
  "base_token_program",
  "quote_token_program",
  "associated_token_program",
  "system_program",
  "rent_program",
  "metadata_program",
] as const;

export const LAUNCHLAB_MIGRATE_AMM_ACCOUNTS = [
  "payer",
  "base_mint",
  "quote_mint",
  "openbook_program",
  "market",
  "request_queue",
  "event_queue",
  "bids",
  "asks",
  "market_vault_signer",
  "market_base_vault",
  "market_quote_vault",
  "amm_program",
  "amm_pool",
  "amm_authority",
  "amm_open_orders",
  "amm_lp_mint",
  "amm_base_vault",
  "amm_quote_vault",
  "amm_target_orders",
  "amm_config",
  "amm_create_fee_destination",
  "authority",
  "pool_state",
  "global_config",
  "base_vault",
  "quote_vault",
  "pool_lp_token",
  "spl_token_program",
  "associated_token_program",
  "system_program",
  "rent_program",
] as const;

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
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpCreate,
    layout: layout(
      "pump_create",
      "pump",
      [
        "mint",
        "mint_authority",
        "bonding_curve",
        "associated_bonding_curve",
        "global",
        "mpl_token_metadata",
        "metadata",
        "user",
      ],
      "create",
      "bonding_curve",
      "mint",
      null,
      "user",
      null,
      null,
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpCreateV2,
    layout: layout(
      "pump_create_v2",
      "pump",
      ["mint", "mint_authority", "bonding_curve", "associated_bonding_curve", "global", "user"],
      "create_v2",
      "bonding_curve",
      "mint",
      null,
      "user",
      null,
      null,
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpBuy,
    layout: layout(
      "pump_buy",
      "pump",
      [
        "global",
        "fee_recipient",
        "mint",
        "bonding_curve",
        "associated_bonding_curve",
        "associated_user",
        "user",
      ],
      "buy",
      "bonding_curve",
      "mint",
      null,
      "user",
      null,
      null,
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpBuyV2,
    layout: layout(
      "pump_buy",
      "pump",
      [
        "global",
        "base_mint",
        "quote_mint",
        "base_token_program",
        "quote_token_program",
        "associated_token_program",
        "fee_recipient",
        "associated_quote_fee_recipient",
        "buyback_fee_recipient",
        "associated_quote_buyback_fee_recipient",
        "bonding_curve",
        "associated_base_bonding_curve",
        "associated_quote_bonding_curve",
        "user",
      ],
      "buy_v2",
      "bonding_curve",
      "base_mint",
      "quote_mint",
      "user",
      null,
      "quote_mint",
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpSell,
    layout: layout(
      "pump_sell",
      "pump",
      [
        "global",
        "fee_recipient",
        "mint",
        "bonding_curve",
        "associated_bonding_curve",
        "associated_user",
        "user",
      ],
      "sell",
      "bonding_curve",
      "mint",
      null,
      "user",
      null,
      null,
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpMigrate,
    layout: layout(
      "pump_migrate",
      "pump",
      [
        "global",
        "withdraw_authority",
        "mint",
        "bonding_curve",
        "associated_bonding_curve",
        "user",
        "system_program",
        "token_program",
        "pump_amm",
        "pool",
      ],
      "migrate",
      "pool",
      "mint",
      null,
      "user",
      "bonding_curve",
      null,
    ),
  },
  {
    programId: PUMP_PROGRAM_ID,
    disc: DISC.ixPumpMigrateV2,
    layout: layout(
      "pump_migrate",
      "pump",
      [
        "global",
        "withdraw_authority",
        "base_mint",
        "quote_mint",
        "bonding_curve",
        "associated_base_bonding_curve",
        "associated_quote_bonding_curve",
        "user",
        "system_program",
        "pump_amm",
        "pool",
      ],
      "migrate_v2",
      "pool",
      "base_mint",
      "quote_mint",
      "user",
      "bonding_curve",
      "quote_mint",
    ),
  },
  {
    programId: PUMP_AMM_PROGRAM_ID,
    disc: DISC.ixPumpAmmCreatePool,
    layout: layout(
      "pumpswap_create_pool",
      "pumpswap",
      ["pool", "global_config", "creator", "base_mint", "quote_mint"],
      "create_pool",
      "pool",
      "base_mint",
      "quote_mint",
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: PUMP_AMM_PROGRAM_ID,
    disc: DISC.ixPumpAmmBuy,
    layout: layout(
      "pumpswap_buy",
      "pumpswap",
      ["pool", "user", "global_config", "base_mint", "quote_mint"],
      "buy",
      "pool",
      "base_mint",
      "quote_mint",
      "user",
      null,
      "quote_mint",
    ),
  },
  {
    programId: PUMP_AMM_PROGRAM_ID,
    disc: DISC.ixPumpAmmBuyV2,
    layout: layout(
      "pumpswap_buy",
      "pumpswap",
      ["pool", "user", "global_config", "base_mint", "quote_mint"],
      "buy_v2",
      "pool",
      "base_mint",
      "quote_mint",
      "user",
      null,
      "quote_mint",
    ),
  },
  {
    programId: PUMP_AMM_PROGRAM_ID,
    disc: DISC.ixPumpAmmSell,
    layout: layout(
      "pumpswap_sell",
      "pumpswap",
      ["pool", "user", "global_config", "base_mint", "quote_mint"],
      "sell",
      "pool",
      "base_mint",
      "quote_mint",
      "user",
      null,
      "quote_mint",
    ),
  },
  {
    programId: PUMP_AMM_PROGRAM_ID,
    disc: DISC.ixPumpAmmSellV2,
    layout: layout(
      "pumpswap_sell",
      "pumpswap",
      ["pool", "user", "global_config", "base_mint", "quote_mint"],
      "sell_v2",
      "pool",
      "base_mint",
      "quote_mint",
      "user",
      null,
      "quote_mint",
    ),
  },
  {
    programId: LAUNCHLAB_PROGRAM_ID,
    disc: DISC.ixLaunchlabInitialize,
    layout: layout(
      "launchlab_initialize",
      "launchlab",
      LAUNCHLAB_INIT_ACCOUNTS,
      "initialize",
      "pool_state",
      "base_mint",
      "quote_mint",
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: LAUNCHLAB_PROGRAM_ID,
    disc: DISC.ixLaunchlabInitializeV2,
    layout: layout(
      "launchlab_initialize",
      "launchlab",
      LAUNCHLAB_INIT_ACCOUNTS,
      "initialize_v2",
      "pool_state",
      "base_mint",
      "quote_mint",
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: LAUNCHLAB_PROGRAM_ID,
    disc: DISC.ixLaunchlabInitializeToken2022,
    layout: layout(
      "launchlab_initialize",
      "launchlab",
      LAUNCHLAB_INIT_TOKEN2022_ACCOUNTS,
      "initialize_with_token_2022",
      "pool_state",
      "base_mint",
      "quote_mint",
      "creator",
      null,
      "quote_mint",
    ),
  },
  {
    programId: LAUNCHLAB_PROGRAM_ID,
    disc: DISC.ixLaunchlabMigrateCpswap,
    layout: layout(
      "launchlab_migrate",
      "launchlab",
      LAUNCHLAB_MIGRATE_CPSWAP_ACCOUNTS,
      "migrate_to_cpswap",
      "cpswap_pool",
      "base_mint",
      "quote_mint",
      "payer",
      "pool_state",
      "quote_mint",
    ),
  },
  {
    programId: LAUNCHLAB_PROGRAM_ID,
    disc: DISC.ixLaunchlabMigrateAmm,
    layout: layout(
      "launchlab_migrate",
      "launchlab",
      LAUNCHLAB_MIGRATE_AMM_ACCOUNTS,
      "migrate_to_amm",
      "amm_pool",
      "base_mint",
      "quote_mint",
      "payer",
      "pool_state",
      "quote_mint",
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

/**
 * Names the parsed-events scan accepts. Helius's DBC IDL does not include
 * initialize_virtual_pool_with_token2022_transfer_hook, and a scan that names
 * it returns HTTP 400. The live subscription still sends that name.
 */
export const DBC_SCAN_INSTRUCTION_NAMES = [
  "initialize_virtual_pool_with_spl_token",
  "initialize_virtual_pool_with_token2022",
  "migration_damm_v2",
] as const;

export const SCAN_INSTRUCTION_NAMES = [
  ...DBC_SCAN_INSTRUCTION_NAMES,
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

/** Creates and graduations. The audit scans these. Trades are a separate, optional firehose. */
export const PUMP_LIFECYCLE_NAMES = ["create", "create_v2", "migrate", "migrate_v2"] as const;

export const PUMP_TRADE_NAMES = [
  "buy",
  "buy_v2",
  "buy_v3",
  "buy_exact_sol_in",
  "buy_exact_quote_in_v2",
  "buy_exact_quote_in_v3",
  "sell",
  "sell_v2",
  "sell_v3",
] as const;

export const PUMP_AMM_LIFECYCLE_NAMES = ["create_pool"] as const;

/** Creates and graduations only. Buys and sells stay off the socket. */
export const LAUNCHLAB_LIFECYCLE_NAMES = [
  "initialize",
  "initialize_v2",
  "initialize_with_token_2022",
  "migrate_to_cpswap",
  "migrate_to_amm",
] as const;

/**
 * PlatformConfig accounts whose on-chain name was read from mainnet.
 * StonkFun ids are the live pricing response (standard, reward, community) and
 * each account's name field is "StonkFun". BONK.fun ids are PlatformConfig accounts
 * owned by LaunchLab whose name field is "letsbonk.fun". FfYek5… is the config
 * Bitquery and the LetsBonk listener document; 82NMHV… is the second account
 * with the same on-chain name. 2RN8d2…, CB6mNV…, and 2TDPJJ… stay unmapped:
 * empty name, the SDK placeholder "My Launch Platform", and Float
 * (floatlaunch.xyz), which is not a FOMO launchpad name.
 */
export const LAUNCHLAB_PLATFORM_LAUNCHPADS: Readonly<Record<string, string>> = {
  "4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7": "StonkFun",
  "6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt": "StonkFun",
  CUqSiwPs6C4WyntMgaFazLp7wYQfaLp5URbjUP9V7SNi: "StonkFun",
  FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1: "BONK.fun",
  "82NMHVCKwehXgbXMyzL41mvv3sdkypaMCtTxvJ4CtTzm": "BONK.fun",
  /**
   * Raydium's own LaunchLab platform. SDK default platform id, on-chain name
   * "Raydium", website https://raydium.io/.
   */
  "4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4": "Raydium Launchlab",
};

/**
 * DBC config pubkey to a FOMO launchpad name. Bags, Believe, and Jupiter Studio
 * do not publish a stable config list, so an unmapped config stays "unknown"
 * and the config id is stored on the coin.
 */
export const METEORA_CONFIG_LAUNCHPADS: Readonly<Record<string, string>> = {};

export const LAUNCHPAD_UNKNOWN = "unknown";

export function launchpadForPlatform(
  platformConfig: string | null,
  venue: IngestVenue,
): { launchpad: string; platformConfig: string | null } {
  if (venue === "pump") return { launchpad: "Pump.fun", platformConfig };
  if (platformConfig === null) return { launchpad: LAUNCHPAD_UNKNOWN, platformConfig: null };
  const table = venue === "launchlab" ? LAUNCHLAB_PLATFORM_LAUNCHPADS : METEORA_CONFIG_LAUNCHPADS;
  return {
    launchpad: table[platformConfig] ?? LAUNCHPAD_UNKNOWN,
    platformConfig,
  };
}

export const PUMP_AMM_TRADE_NAMES = [
  "buy",
  "buy_v2",
  "buy_exact_quote_in",
  "buy_exact_quote_in_v2",
  "sell",
  "sell_v2",
] as const;

/** Full trade rows are kept for this many slots after the coin's create. About one minute. */
export const PUMP_TRADE_DETAIL_SLOTS = 150;

export function programsForVenue(venue: IngestVenue): readonly string[] {
  if (venue === "pump") return PUMP_PROGRAMS;
  if (venue === "launchlab") return LAUNCHLAB_PROGRAMS;
  return METEORA_LAUNCH_PROGRAMS;
}

export function programsForVenues(venues: readonly IngestVenue[]): readonly string[] {
  const out: string[] = [];
  for (const venue of venues) {
    for (const programId of programsForVenue(venue)) {
      if (!out.includes(programId)) out.push(programId);
    }
  }
  return out;
}

export function venueForProgram(programId: string): IngestVenue | null {
  if ((PUMP_PROGRAMS as readonly string[]).includes(programId)) return "pump";
  if (programId === LAUNCHLAB_PROGRAM_ID) return "launchlab";
  if ((METEORA_LAUNCH_PROGRAMS as readonly string[]).includes(programId)) return "meteora";
  if (programId === DLMM_PROGRAM_ID) return "meteora";
  return null;
}

const VENUE_NAMES = ["pump", "launchlab", "meteora"] as const;

/** INGEST_VENUES wins. Otherwise the old single INGEST_VENUE is the whole set. */
export function enabledVenues(env: {
  INGEST_VENUES?: string;
  INGEST_VENUE: "pump" | "meteora";
}): IngestVenue[] {
  const raw = env.INGEST_VENUES?.trim();
  if (!raw) return [env.INGEST_VENUE];
  const out: IngestVenue[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (name.length === 0) continue;
    if (!VENUE_NAMES.includes(name as (typeof VENUE_NAMES)[number])) {
      throw new ConfigError("INGEST_VENUES: invalid_venue");
    }
    const venue = name as IngestVenue;
    if (!out.includes(venue)) out.push(venue);
  }
  if (out.length === 0) throw new ConfigError("INGEST_VENUES: empty");
  return out;
}

/** Programs that actually appear on the websocket. Empty name lists are not subscribed. */
export function subscribedPrograms(input: {
  venue?: IngestVenue;
  venues?: readonly IngestVenue[];
  includeTrades: boolean;
  includeCreatePool: boolean;
}): readonly string[] {
  const venues = input.venues ?? (input.venue ? [input.venue] : []);
  return programsForVenues(venues).filter(
    (programId) =>
      subscriptionNamesForProgram(programId, input.includeTrades, input.includeCreatePool).length >
      0,
  );
}

export function subscriptionNamesForProgram(
  programId: string,
  includeTrades: boolean,
  includeCreatePool = false,
): readonly string[] {
  if (programId === PUMP_PROGRAM_ID) {
    return includeTrades ? [...PUMP_LIFECYCLE_NAMES, ...PUMP_TRADE_NAMES] : PUMP_LIFECYCLE_NAMES;
  }
  if (programId === PUMP_AMM_PROGRAM_ID) {
    const lifecycle = includeCreatePool ? PUMP_AMM_LIFECYCLE_NAMES : [];
    return includeTrades ? [...lifecycle, ...PUMP_AMM_TRADE_NAMES] : lifecycle;
  }
  if (programId === LAUNCHLAB_PROGRAM_ID) return LAUNCHLAB_LIFECYCLE_NAMES;
  return parsedNamesForProgram(programId);
}

export function scanNamesForProgram(
  programId: string,
  includeCreatePool = false,
): readonly string[] {
  if (programId === DBC_PROGRAM_ID) return DBC_SCAN_INSTRUCTION_NAMES;
  if (programId === PUMP_PROGRAM_ID) return PUMP_LIFECYCLE_NAMES;
  if (programId === PUMP_AMM_PROGRAM_ID) return includeCreatePool ? PUMP_AMM_LIFECYCLE_NAMES : [];
  if (programId === LAUNCHLAB_PROGRAM_ID) return LAUNCHLAB_LIFECYCLE_NAMES;
  return parsedNamesForProgram(programId);
}

/** Pump program history is mostly swaps. Five minutes finishes inside the audit page budget. */
export function auditSpanSlots(programId: string): number {
  const slotsPerSecond = 1000 / 215;
  const minutes =
    programId === PUMP_PROGRAM_ID ||
    programId === PUMP_AMM_PROGRAM_ID ||
    programId === LAUNCHLAB_PROGRAM_ID
      ? 5
      : 15;
  return Math.round(minutes * 60 * slotsPerSecond);
}

/**
 * Pages of 10,000 transactions. Five minutes of a ~200 tx/s program is about
 * 60,000 transactions, so eight pages finishes it. Each full page-request is
 * about 20 credits.
 */
export function auditMaxPages(programId: string): number {
  if (programId === PUMP_PROGRAM_ID || programId === PUMP_AMM_PROGRAM_ID) return 8;
  return 8;
}

export function isHighVolumeProgram(programId: string): boolean {
  return (
    (HIGH_VOLUME_PROGRAM_IDS as readonly string[]).includes(programId) ||
    programId === PUMP_PROGRAM_ID ||
    programId === PUMP_AMM_PROGRAM_ID ||
    programId === LAUNCHLAB_PROGRAM_ID
  );
}

export function isPumpTradeKind(kind: EventKind): boolean {
  return (
    kind === "pump_buy" ||
    kind === "pump_sell" ||
    kind === "pumpswap_buy" ||
    kind === "pumpswap_sell"
  );
}

export function isPumpLifecycleKind(kind: EventKind): boolean {
  return (
    kind === "pump_create" ||
    kind === "pump_create_v2" ||
    kind === "pump_migrate" ||
    kind === "pumpswap_create_pool"
  );
}

/** full = store the event. detail = store this trade. aggregate = counts only. skip = ignore. */
export function pumpTradeRetention(input: {
  kind: EventKind;
  slot: number;
  trader: string | null;
  creator: string | null;
  createdSlot: number | null;
  detailSlots?: number;
}): "full" | "detail" | "aggregate" | "skip" {
  if (!isPumpTradeKind(input.kind) && !isPumpLifecycleKind(input.kind)) return "full";
  if (isPumpLifecycleKind(input.kind)) return "full";
  const window = input.detailSlots ?? PUMP_TRADE_DETAIL_SLOTS;
  if (input.trader !== null && input.creator !== null && input.trader === input.creator) {
    return "detail";
  }
  if (input.createdSlot !== null && input.slot <= input.createdSlot + window) return "detail";
  if (input.createdSlot !== null) return "aggregate";
  return "skip";
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
