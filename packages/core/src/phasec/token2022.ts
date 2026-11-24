/** Token-2022 mint extensions. A classic 82-byte mint has none. */

export type TokenExtensionStatus = "classic" | "clear" | "dangerous" | "unknown";

export interface TokenExtensionReport {
  status: TokenExtensionStatus;
  /** Names we could read. Metadata is listed and is not treated as dangerous. */
  known: string[];
  /** Extension types we do not have a policy for. These stay unknown, not a pass. */
  unrecognized: number[];
}

const MINT_ACCOUNT_TYPE_OFFSET = 165;
const TLV_START = 166;
const METADATA_TYPES = new Set([18, 19]);
const KNOWN_SAFE_TYPES = new Set([3, 18, 19]);

function u16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) + ((data[offset + 1] ?? 0) << 8);
}

function nonZero(data: Uint8Array, offset: number, length: number): boolean {
  for (let index = 0; index < length; index += 1) {
    if ((data[offset + index] ?? 0) !== 0) return true;
  }
  return false;
}

/**
 * Read the extension list. Metadata-only extensions are not dangerous.
 * Transfer hook, permanent delegate, a default frozen state, and non-transferable are.
 * Anything else we cannot name stays unknown, which the screen must not treat as a pass.
 */
export function readTokenExtensions(data: Uint8Array): TokenExtensionReport {
  if (data.length <= 82) return { status: "classic", known: [], unrecognized: [] };
  if (data.length < TLV_START || data[MINT_ACCOUNT_TYPE_OFFSET] !== 1) {
    return { status: "unknown", known: [], unrecognized: [] };
  }
  const known: string[] = [];
  const unrecognized: number[] = [];
  let dangerous = false;
  let offset = TLV_START;
  while (offset + 4 <= data.length) {
    const type = u16(data, offset);
    const length = u16(data, offset + 2);
    const start = offset + 4;
    if (start + length > data.length) return { status: "unknown", known, unrecognized };
    if (type === 0 && length === 0) break;
    if (type === 14 && length >= 64 && nonZero(data, start + 32, 32)) {
      known.push("transfer hook");
      dangerous = true;
    } else if (type === 12 && length >= 32 && nonZero(data, start, 32)) {
      known.push("permanent delegate");
      dangerous = true;
    } else if (type === 6 && length >= 1 && data[start] === 2) {
      known.push("default frozen");
      dangerous = true;
    } else if (type === 9) {
      known.push("non-transferable");
      dangerous = true;
    } else if (METADATA_TYPES.has(type)) {
      known.push(type === 18 ? "metadata pointer" : "token metadata");
    } else if (KNOWN_SAFE_TYPES.has(type)) {
      known.push("mint close authority");
    } else if (type !== 0) {
      unrecognized.push(type);
    }
    offset = start + length;
  }
  if (unrecognized.length > 0) return { status: "unknown", known, unrecognized };
  return { status: dangerous ? "dangerous" : "clear", known, unrecognized };
}
