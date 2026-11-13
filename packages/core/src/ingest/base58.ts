const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map<string, number>([...ALPHABET].map((char, index) => [char, index]));

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  if (zeros === bytes.length) return "1".repeat(bytes.length);
  const digits: number[] = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j += 1) {
      carry += (digits[j] ?? 0) << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k -= 1) {
    out += ALPHABET[digits[k] ?? 0] ?? "";
  }
  return out;
}

export function decodeBase58(text: string): Uint8Array {
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  if (zeros === text.length) return new Uint8Array(zeros);
  const bytes: number[] = [0];
  for (let i = zeros; i < text.length; i += 1) {
    const value = INDEX.get(text[i] ?? "");
    if (value === undefined) {
      throw new Error("invalid base58");
    }
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let k = 0; k < bytes.length; k += 1) {
    out[out.length - 1 - k] = bytes[k] ?? 0;
  }
  return out;
}
