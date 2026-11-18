/**
 * Flap bonding-curve Portal on BNB Chain.
 * Events and getTokenV8Safe: https://docs.flap.sh/flap/v2/developers/bonding-curve/build-an-indexer
 * Topic0 values are keccak256 of the canonical event signature. Fields are not
 * indexed, so the payload is ABI-encoded in the log data.
 */

export const BSC_CHAIN = "bsc";

/** Portal proxy. https://docs.flap.sh deployed addresses, BNB Chain. */
export const FLAP_PORTAL = "0xe2ce6ab80874fa9fa2aae65d277dd6b8e65c9de0";

export const FLAP_LAUNCHPAD = "Flap";

/** keccak256("TokenCreated(uint256,address,uint256,address,string,string,string)") */
export const TOPIC_TOKEN_CREATED =
  "0x504e7f360b2e5fe33cbaaae4c593bc55305328341bf79009e43e0e3b7f699603";
/** keccak256("LaunchedToDEX(address,address,uint256,uint256)") */
export const TOPIC_LAUNCHED_TO_DEX =
  "0x6e4f47630b8745b8cacbd44f42a8a33e7eea7cc08ef22fc7630f4f385784ff7d";
/** keccak256("FlapTokenCLPoolCreated(address,bytes32,uint160)") */
export const TOPIC_CL_POOL_CREATED =
  "0xb1acc4d02e54a5f769cd0b689d82b8b5d5be55f2557a17d9d202e227cff2d335";
/** keccak256("FlapTokenTaxSet(address,uint256)") */
export const TOPIC_TAX_SET = "0x1546924f4680b1b2e093fd251c437c8781d81a21ed8ad1895e1f2c9b78db0cd0";

/** First 4 bytes of keccak256("getTokenV8Safe(address)"). */
export const GET_TOKEN_V8_SAFE_SELECTOR = "0x62fafcca";

export const FLAP_LOG_TOPICS = [
  TOPIC_TOKEN_CREATED,
  TOPIC_LAUNCHED_TO_DEX,
  TOPIC_CL_POOL_CREATED,
  TOPIC_TAX_SET,
] as const;

export interface FlapCreate {
  kind: "create";
  token: string;
  creator: string;
  name: string;
  symbol: string;
  meta: string;
}

export interface FlapTax {
  kind: "tax";
  token: string;
  taxBps: number;
}

export interface FlapLaunch {
  kind: "launch";
  token: string;
  pool: string;
}

export interface FlapClPool {
  kind: "cl";
  token: string;
  poolId: string;
}

export type FlapEvent = FlapCreate | FlapTax | FlapLaunch | FlapClPool;

export interface FlapTokenState {
  status: number;
  quoteToken: string;
  buyTaxBps: number;
  sellTaxBps: number;
  pool: string;
}

export function decodePortalLog(topic0: string, data: string): FlapEvent | null {
  const topic = topic0.toLowerCase();
  const bytes = hexToBytes(data);
  if (topic === TOPIC_TOKEN_CREATED) return decodeCreated(bytes);
  if (topic === TOPIC_TAX_SET) return decodeTax(bytes);
  if (topic === TOPIC_LAUNCHED_TO_DEX) return decodeLaunch(bytes);
  if (topic === TOPIC_CL_POOL_CREATED) return decodeCl(bytes);
  return null;
}

export function encodeGetTokenV8Safe(token: string): string {
  const address = token.toLowerCase().replace(/^0x/, "").padStart(40, "0");
  return `${GET_TOKEN_V8_SAFE_SELECTOR}${address.padStart(64, "0")}`;
}

/** ABI words of TokenStateV8Safe. Enums and addresses are padded to 32 bytes. */
export function decodeTokenStateV8(data: string): FlapTokenState | null {
  const bytes = hexToBytes(data);
  if (bytes.length < 18 * 32) return null;
  return {
    status: Number(uintOf(word(bytes, 0))),
    quoteToken: addressOf(word(bytes, 9)),
    buyTaxBps: Number(uintOf(word(bytes, 12))),
    sellTaxBps: Number(uintOf(word(bytes, 13))),
    pool: addressOf(word(bytes, 14)),
  };
}

/**
 * Request URLs for a later screen. Nothing in the ingest path calls these,
 * and a result is never sent to Telegram.
 */
export function flapScreenRequests(token: string): { goplus: string; honeypot: string } {
  const address = token.toLowerCase();
  return {
    goplus: `https://api.gopluslabs.io/api/v1/token_security/56?contract_addresses=${address}`,
    honeypot: `https://api.honeypot.is/v2/IsHoneypot?chainID=56&address=${address}`,
  };
}

function decodeCreated(bytes: Uint8Array): FlapCreate | null {
  if (bytes.length < 7 * 32) return null;
  const name = readString(bytes, Number(uintOf(word(bytes, 4))));
  const symbol = readString(bytes, Number(uintOf(word(bytes, 5))));
  const meta = readString(bytes, Number(uintOf(word(bytes, 6))));
  if (name === null || symbol === null || meta === null) return null;
  return {
    kind: "create",
    token: addressOf(word(bytes, 3)),
    creator: addressOf(word(bytes, 1)),
    name,
    symbol,
    meta,
  };
}

function decodeTax(bytes: Uint8Array): FlapTax | null {
  if (bytes.length < 64) return null;
  return { kind: "tax", token: addressOf(word(bytes, 0)), taxBps: Number(uintOf(word(bytes, 1))) };
}

function decodeLaunch(bytes: Uint8Array): FlapLaunch | null {
  if (bytes.length < 128) return null;
  return { kind: "launch", token: addressOf(word(bytes, 0)), pool: addressOf(word(bytes, 1)) };
}

function decodeCl(bytes: Uint8Array): FlapClPool | null {
  if (bytes.length < 96) return null;
  return {
    kind: "cl",
    token: addressOf(word(bytes, 0)),
    poolId: `0x${hexOf(word(bytes, 1))}`,
  };
}

function readString(bytes: Uint8Array, offset: number): string | null {
  if (!Number.isFinite(offset) || offset < 0 || offset + 32 > bytes.length) return null;
  const length = Number(uintOf(bytes.subarray(offset, offset + 32)));
  if (!Number.isFinite(length) || length < 0 || offset + 32 + length > bytes.length) return null;
  return new TextDecoder().decode(bytes.subarray(offset + 32, offset + 32 + length));
}

function word(bytes: Uint8Array, index: number): Uint8Array {
  return bytes.subarray(index * 32, index * 32 + 32);
}

function addressOf(value: Uint8Array): string {
  return `0x${hexOf(value.subarray(12))}`;
}

function uintOf(value: Uint8Array): bigint {
  let out = 0n;
  for (const byte of value) out = (out << 8n) + BigInt(byte);
  return out;
}

function hexOf(value: Uint8Array): string {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    const byte = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(byte)) return new Uint8Array();
    out[index] = byte;
  }
  return out;
}
