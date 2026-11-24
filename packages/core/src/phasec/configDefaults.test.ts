import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadThresholds } from "../config/thresholds.js";
import type { Env } from "../config/env.js";
import { phaseCConfigFromEnv } from "./config.js";

const thresholdsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../config/thresholds.yaml",
);

describe("experiment config defaults", () => {
  it("uses $20, the frozen 10% cap, no stop, and scale-out off", () => {
    const config = phaseCConfigFromEnv({} as Env, loadThresholds(thresholdsPath));
    expect(config.fixedNotionalUsd).toBe(20);
    expect(config.maxRoundTripImpactPct).toBe(10);
    expect(config.experimentProtocol).toBe(true);
    expect(config.stopsEnabled).toBe(false);
    expect(config.scaleOutEnabled).toBe(false);
    expect(config.entryDelaySec).toBe(180);
    expect(config.paperWindowDays).toBe(60);
  });
});
