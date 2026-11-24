/** Exact opt-in. Unset, empty, and any other value stay off. */
export function serviceEnabled(flag: string | undefined): boolean {
  return flag === "true";
}
