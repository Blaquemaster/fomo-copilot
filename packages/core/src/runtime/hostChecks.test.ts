import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

function modes() {
  return {
    paper: false,
    alerts: false,
    outcomes: false,
    shadow: false,
    wideRecovery: false,
  };
}

function target(digest: string, builtAt: string, overrides: Record<string, unknown> = {}) {
  return {
    imageDigest: digest,
    builtAt,
    schemaRequirements: ["031_run_identity"],
    permittedServices: ["screener"],
    permittedModes: modes(),
    gateTestsPassed: true,
    evidence: ["verify", "compose-gates"],
    ...overrides,
  };
}

function writeInputs(manifest: unknown, schema = "031_run_identity\n") {
  const dir = mkdtempSync(path.join(tmpdir(), "fomo-host-"));
  const manifestPath = path.join(dir, "manifest.json");
  const schemaPath = path.join(dir, "schema.txt");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(schemaPath, schema);
  return { manifestPath, schemaPath };
}

function decide(manifest: unknown, digest?: string, schema?: string) {
  const files = writeInputs(manifest, schema);
  const args = [
    path.join(root, "scripts/rollback-decision.mjs"),
    "--manifest",
    files.manifestPath,
    "--schema",
    files.schemaPath,
  ];
  if (digest !== undefined) args.push("--digest", digest);
  const stdout = execFileSync("node", args, { encoding: "utf8" });
  return JSON.parse(stdout) as { action: string; reason: string; imageDigest?: string };
}

describe("approved rollback manifest", () => {
  const guarded = "sha256:guarded";
  const unguarded = "sha256:unguarded";

  it("rejects an unlisted image and accepts the listed digest without using age", () => {
    const manifest = {
      affectedServices: ["screener", "alerter", "outcomes", "shadow"],
      targets: [
        target(guarded, "2020-01-01T00:00:00Z"),
        target(unguarded, "2026-11-24T00:00:00Z", { gateTestsPassed: false }),
      ],
    };
    expect(decide(manifest, unguarded).action).toBe("reject");
    expect(decide(manifest, unguarded).reason).toBe("target not in approved rollback manifest");
    expect(decide(manifest, guarded)).toMatchObject({ action: "start", imageDigest: guarded });
  });

  it("stops for a forward fix when nothing in the manifest is approved", () => {
    expect(decide({ targets: [] }, unguarded)).toMatchObject({
      action: "stop",
      reason: "no approved fallback",
      forwardFix: true,
    });
    expect(
      decide(
        {
          targets: [
            target(guarded, "2026-01-01T00:00:00Z", {
              permittedModes: { ...modes(), paper: true },
            }),
          ],
        },
        guarded,
      ),
    ).toMatchObject({ action: "stop" });
    expect(
      decide({ targets: [target(guarded, "2026-01-01T00:00:00Z")] }, guarded, "\n"),
    ).toMatchObject({
      action: "stop",
    });
  });

  it("does not choose among several approved digests by age", () => {
    const older = target(guarded, "2020-01-01T00:00:00Z");
    const newer = target("sha256:newer", "2026-11-24T00:00:00Z");
    expect(decide({ targets: [older, newer] })).toMatchObject({
      action: "reject",
      reason: "explicit digest required",
    });
  });

  it("rejects the unguarded target in the host command before any start", () => {
    const files = writeInputs({
      targets: [target(guarded, "2020-01-01T00:00:00Z")],
    });
    try {
      execFileSync(
        "bash",
        [
          path.join(root, "scripts/approved-rollback.sh"),
          "--manifest",
          files.manifestPath,
          "--schema",
          files.schemaPath,
          "--digest",
          unguarded,
          "--execute",
        ],
        { encoding: "utf8" },
      );
      throw new Error("the unguarded digest was accepted");
    } catch (error) {
      if (error instanceof Error && error.message === "the unguarded digest was accepted")
        throw error;
      const failed = error as { status: number; stderr: string; stdout: string };
      expect(failed.status).toBe(3);
      expect(failed.stderr).toContain("rejected before start");
      expect(failed.stdout).not.toContain("without a stop gate");
    }
  });
});

function preflightPair(overrides: Record<string, unknown> = {}) {
  const accepted = {
    imageDigest: "sha256:running",
    configFingerprint: "cfg",
    runId: "run-1",
    venueScope: ["pump"],
    walletListVersion: "wallets-v1",
    wideRecovery: { flag: "disabled" },
  };
  const observed = {
    imageDigest: "sha256:running",
    configFingerprint: "cfg",
    runId: "run-1",
    venueScope: ["pump"],
    walletListVersion: "wallets-v1",
    shadowPermissions: { prohibitedWritesDenied: true },
    reconciliationCycle: {
      ran: true,
      services: ["ingestor", "outcomes"],
      cursorAdvanced: true,
      observationStored: true,
    },
    lookbackComplete: true,
    schedules: { referenceReconciliation: "running", freshness: "running" },
    wideRecovery: { flag: "disabled", gapHandling: "unrecovered" },
    ...overrides,
  };
  return { accepted, observed };
}

function runPreflight(accepted: unknown, observed: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "fomo-preflight-"));
  const acceptedPath = path.join(dir, "accepted.json");
  const observedPath = path.join(dir, "observed.json");
  writeFileSync(acceptedPath, JSON.stringify(accepted));
  writeFileSync(observedPath, JSON.stringify(observed));
  try {
    const stdout = execFileSync(
      "bash",
      [
        path.join(root, "scripts/preflight.sh"),
        "--accepted",
        acceptedPath,
        "--observed",
        observedPath,
      ],
      { encoding: "utf8" },
    );
    return {
      code: 0,
      body: JSON.parse(stdout) as { pass: boolean; reasons?: string[]; shadowClockStarts: boolean },
    };
  } catch (error) {
    const failed = error as { status: number; stdout: string };
    return {
      code: failed.status,
      body: JSON.parse(failed.stdout) as {
        pass: boolean;
        reasons: string[];
        shadowClockStarts: boolean;
      },
    };
  }
}

describe("preflight checker", () => {
  it("passes a complete observed report and refuses a remote host", () => {
    const { accepted, observed } = preflightPair();
    expect(runPreflight(accepted, observed).body).toMatchObject({
      pass: true,
      shadowClockStarts: true,
    });
    expect(() =>
      execFileSync("bash", [path.join(root, "scripts/preflight.sh"), "--host"], {
        encoding: "utf8",
      }),
    ).toThrow(/does not open a remote host/);
  });

  it("shapes a live probe and feeds it to the checker", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fomo-preflight-live-"));
    const rawPath = path.join(dir, "raw.json");
    const acceptedPath = path.join(dir, "accepted.json");
    const raw = {
      imageId: "sha256:running",
      imageDigests: { "fomo-ci-shadow-1": "sha256:running" },
      wideRecoveryEnv: "unset",
      configFingerprint: "cfg",
      configBody: JSON.stringify({
        effectiveConfig: { venueAllowlist: ["pump"], walletListVersion: "wallets-v1" },
      }),
      runIds: ["run-1"],
      walletListHash: "wallets-v1",
      recall: { start: 1, end: 2, skipped: false, errored: false, incomplete: false, age: 10 },
      observation: { mint: "m", label: "60m" },
      lookbackStart: "2026-11-23T00:00:00Z",
      lookbackEnd: "2026-11-24T00:00:00Z",
      statusAge: 5,
      wideCompleted: 0,
      writeDenied: true,
      writeRolledBack: true,
    };
    writeFileSync(rawPath, JSON.stringify(raw));
    writeFileSync(acceptedPath, JSON.stringify(preflightPair().accepted));
    const stdout = execFileSync(
      "node",
      [
        path.join(root, "scripts/preflight-live.mjs"),
        "--fixture",
        rawPath,
        "--accepted",
        acceptedPath,
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(stdout) as {
      observed: { shadowPermissions: { prohibitedWritesDenied: boolean }; runId: string };
      result: { pass: boolean; shadowClockStarts: boolean };
    };
    expect(parsed.result).toMatchObject({ pass: true, shadowClockStarts: true });
    expect(parsed.observed.runId).toBe("run-1");
    const denied = { ...raw, writeDenied: false };
    writeFileSync(rawPath, JSON.stringify(denied));
    try {
      execFileSync(
        "node",
        [
          path.join(root, "scripts/preflight-live.mjs"),
          "--fixture",
          rawPath,
          "--accepted",
          acceptedPath,
        ],
        { encoding: "utf8" },
      );
      throw new Error("a permitted write was accepted");
    } catch (error) {
      if (error instanceof Error && error.message === "a permitted write was accepted") throw error;
      const failed = error as { stdout: string };
      expect(failed.stdout).toContain("shadow_permissions");
    }
  });

  it("fails closed when permissions, the cycle, or wide recovery do not match", () => {
    const { accepted, observed } = preflightPair();
    expect(
      runPreflight(accepted, {
        ...observed,
        shadowPermissions: { prohibitedWritesDenied: false },
      }).body.reasons,
    ).toContain("shadow_permissions");
    expect(
      runPreflight(accepted, {
        ...observed,
        wideRecovery: { flag: "disabled", gapHandling: "recovered" },
      }).body.reasons,
    ).toContain("wide_recovery_gap");
    expect(
      runPreflight(accepted, {
        ...observed,
        schedules: { referenceReconciliation: "stopped", freshness: "running" },
      }).body.shadowClockStarts,
    ).toBe(false);
  });
});
