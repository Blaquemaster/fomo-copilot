import { encodeBase58 } from "./base58.js";

export interface Reader {
  bytes: Uint8Array;
  offset: number;
}

export function reader(bytes: Uint8Array, offset = 0): Reader {
  return { bytes, offset };
}

export function readPubkey(input: Reader): string | null {
  if (input.offset + 32 > input.bytes.length) return null;
  const slice = input.bytes.subarray(input.offset, input.offset + 32);
  input.offset += 32;
  return encodeBase58(slice);
}

export function readU8(input: Reader): number | null {
  if (input.offset + 1 > input.bytes.length) return null;
  const value = input.bytes[input.offset] ?? 0;
  input.offset += 1;
  return value;
}

export function readU16(input: Reader): number | null {
  if (input.offset + 2 > input.bytes.length) return null;
  const view = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const value = view.getUint16(input.offset, true);
  input.offset += 2;
  return value;
}

export function readU64(input: Reader): bigint | null {
  if (input.offset + 8 > input.bytes.length) return null;
  const view = new DataView(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength);
  const value = view.getBigUint64(input.offset, true);
  input.offset += 8;
  return value;
}
