import { JUPITER_EXECUTE_URL, JUPITER_ORDER_URL, maySubmitToNetwork } from "./contract.js";

export interface SwapRequest {
  method: "GET" | "POST";
  url: string;
  body: null;
}

/** Builds the Swap V2 request and does not send it. The submission boundary stays held. */
export function placeSwap(input: { mint: string; amount: number }): {
  sent: false;
  reason: "submission_boundary_held";
  order: SwapRequest;
  execute: SwapRequest;
} {
  maySubmitToNetwork();
  return {
    sent: false,
    reason: "submission_boundary_held",
    order: {
      method: "GET",
      url: `${JUPITER_ORDER_URL}?mint=${encodeURIComponent(input.mint)}`,
      body: null,
    },
    execute: { method: "POST", url: JUPITER_EXECUTE_URL, body: null },
  };
}
