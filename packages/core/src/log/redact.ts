const SENSITIVE_KEY =
  /password|secret|token|api[_-]?key|authorization|credential|private[_-]?key|database[_-]?url|dsn|cookie/i;

const TELEGRAM_TOKEN_IN_URL = /bot\d{6,12}:[A-Za-z0-9_-]{20,}/g;
const TELEGRAM_TOKEN = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g;
const POSTGRES_URL = /postgres(?:ql)?:\/\/([^:\s/]+):([^@\s/]+)@/gi;
const BEARER = /\bBearer\s+\S+/gi;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function redactString(value: string, secrets: readonly string[] = []): string {
  let out = value;
  const sorted = [...secrets]
    .filter((secret) => secret.length >= 8)
    .sort((a, b) => b.length - a.length);
  for (const secret of sorted) {
    out = out.split(secret).join("[REDACTED]");
  }
  out = out.replace(TELEGRAM_TOKEN_IN_URL, "bot[REDACTED]");
  out = out.replace(TELEGRAM_TOKEN, "[REDACTED]");
  out = out.replace(POSTGRES_URL, "postgres://$1:[REDACTED]@");
  out = out.replace(BEARER, "Bearer [REDACTED]");
  return out;
}

export function redact(
  value: unknown,
  secrets: readonly string[] = [],
  seen?: WeakSet<object>,
): unknown {
  const visiting = seen ?? new WeakSet<object>();
  if (typeof value === "string") return redactString(value, secrets);
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message, secrets),
      stack: value.stack === undefined ? undefined : redactString(value.stack, secrets),
    };
  }
  if (typeof value !== "object") return redactString(String(value), secrets);
  if (visiting.has(value)) return "[Circular]";
  visiting.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, secrets, visiting));
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? "[REDACTED]" : redact(child, secrets, visiting);
  }
  return out;
}
