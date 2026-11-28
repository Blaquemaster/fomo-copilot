import { migrate } from "../db/ingest.js";
import { PERMISSIONS_APPLIED, PERMISSION_MAP } from "../db/permissions.js";
import { replacementAllowed } from "../execution/contract.js";
import { sizedFromRoute } from "../records/readiness.js";
import { FAILURE_MAP, balanceAfterRestart } from "../runtime/failures.js";
import { serviceEnabled } from "../runtime/serviceGate.js";
import { EXECUTION_ASSUMPTIONS, PRIMARY_COMPARISON } from "./primary.js";

export interface CatalogReport {
  inferentialGoEnabled: false;
  notAnEdge: true;
  assumptionsVersion: string;
  scenarios: { name: string; passed: boolean }[];
}

/** One fixture report. A passing scenario is not a claim of an edge. */
export function runEvaluationCatalog(): CatalogReport {
  const stale = sizedFromRoute({ route: "unavailable", amount: 5 });
  const restart = balanceAfterRestart({ mint: "mint-a", reserved: 5 });
  const signer = PERMISSION_MAP.find((row) => row.process === "signer");
  const scenarios = [
    { name: "outage", passed: serviceEnabled(undefined) === false },
    { name: "migration", passed: typeof migrate === "function" },
    { name: "duplicate", passed: replacementAllowed("uncertain") === false },
    { name: "restart", passed: restart.reserved === 5 },
    { name: "stale", passed: stale.state === "unavailable" && stale.value === null },
    { name: "unavailable_quote", passed: stale.value === null },
    { name: "uncertain_execution", passed: replacementAllowed("submitted") === false },
    { name: "partial_exit", passed: FAILURE_MAP.entry_pause.exits === "allowed" },
    { name: "budget", passed: FAILURE_MAP.credit_ceiling.ingestor === "keeps_running" },
    { name: "permission", passed: PERMISSIONS_APPLIED === false && signer?.role === null },
  ];
  return {
    inferentialGoEnabled: false,
    notAnEdge: true,
    assumptionsVersion: EXECUTION_ASSUMPTIONS.version,
    scenarios,
  };
}

export function catalogClaimsNoEdge(): boolean {
  return (
    runEvaluationCatalog().notAnEdge === true && PRIMARY_COMPARISON.inferentialGoEnabled === false
  );
}
