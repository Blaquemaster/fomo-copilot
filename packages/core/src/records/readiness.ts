/** Implemented code can still have unavailable inputs. Unavailable is not a zero and not a pass. */
export type DataReadiness<T> = { state: "ready"; value: T } | { state: "unavailable"; value: null };

export function sizedFromRoute(input: {
  route: "available" | "unavailable";
  amount: number;
}): DataReadiness<number> {
  if (input.route === "unavailable") return { state: "unavailable", value: null };
  return { state: "ready", value: input.amount };
}
