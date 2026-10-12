import { describe, expect, it } from "vitest";
import { comparePackagedReceipt } from "./expert-packaged-receipt.mjs";
import { expertLocalProfile } from "./expert-local-profile.mjs";

describe("expert local QA provenance", () => {
  it("resolves all reviewed deployment profiles from one table", async () => {
    const profiles = await Promise.all(["daily", "default", "content-v011", "content-v012", "content-v013"].map(key => expertLocalProfile(key)));
    expect(profiles.map(profile => profile.hostPort)).toEqual([18081, 18158, 18159, 18160, 18161]);
    expect(new Set(profiles.map(profile => profile.identifier)).size).toBe(5);
    expect(new Set(profiles.map(profile => profile.runtimeDirectory)).size).toBe(5);
  });

  it("compares normal build records without running or manufacturing executables", async () => {
    const record = {
      schema_version: 1, feature: "FEAT-158", release: false, kind: "canonical_local_qa_build",
      profile: await expertLocalProfile("content-v012"),
      inputs: { sources: { "src/main.ts": "a".repeat(64) }, workerSources: { "worker/src/main.rs": "e".repeat(64) }, environmentSha256: {} },
      artifacts: { bundleFiles: [], host: { sha256: "b".repeat(64) } },
    };
    expect(() => comparePackagedReceipt(record, structuredClone(record))).not.toThrow();
    // These are plain records for two normal builds, not modified artifacts or
    // fake programs. A new build cannot be represented as reopening the first.
    const nextBuild = structuredClone(record);
    nextBuild.inputs.sources["src/main.ts"] = "c".repeat(64);
    expect(() => comparePackagedReceipt(record, nextBuild)).toThrow("inputs drift");
    const nextWorkerBuild = structuredClone(record);
    nextWorkerBuild.inputs.workerSources["worker/src/main.rs"] = "f".repeat(64);
    expect(() => comparePackagedReceipt(record, nextWorkerBuild)).toThrow("inputs drift");
    const nextProfile = structuredClone(record);
    nextProfile.profile = await expertLocalProfile("content-v011");
    expect(() => comparePackagedReceipt(record, nextProfile)).toThrow("profile drift");
    const nextArtifactRecord = structuredClone(record);
    nextArtifactRecord.artifacts.host.sha256 = "d".repeat(64);
    expect(() => comparePackagedReceipt(record, nextArtifactRecord)).toThrow("artifacts drift");
  });
});
