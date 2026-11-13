import type { ZodError } from "zod";

/** Thrown when thresholds or environment fail validation. The message never includes values. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Path and issue code only. Zod's default message can echo the rejected value. */
export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map((part) => String(part)).join(".") : "<root>";
      return `${path}: ${issue.code}`;
    })
    .join("; ");
}
