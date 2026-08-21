import { describe, expect, it } from "vitest";
import {
  checkFeat128S9bDDependencies,
  validateDependencyFacts,
  validateHistoricalScopeFiles,
  validateProtectedBoundaryFiles,
} from "./check-feat128-s9b-d-dependencies.mjs";

describe("FEAT-128 S9B-D dependency boundary", () => {
  it("accepts only the frozen dependency identities", () => {
    expect(() => validateDependencyFacts({
      echarts: {
        version: "6.1.0",
        license: "Apache-2.0",
        integrity: "sha512-q0yaFPggC9FUdsWH4blavRWFmxdrIodbkoKNAjJudAI6CA9gNPxHtV2RcZNEepZVlk4yvBYkOkbk6HIVpIyHZA==",
      },
      zrender: {
        version: "6.1.0",
        license: "BSD-3-Clause",
        integrity: "sha512-oEGMDB6pOP2S6OwRR4PdVv610zrjnA3Bh+JnSG12fYJlBKjtNAoEb5fSUoCOOINlH96I2fU38/A2UpRKs67xYQ==",
      },
      tslib: {
        version: "2.3.0",
        license: "0BSD",
        integrity: "sha512-N82ooyxVNm6h1riLCoyS9e3fuJ3AMG2zIZs2Gd1ATcSFjSA23Q0fzjjZeh0jbJvWVDZ0cJT8yaNNaaXHzueNjg==",
      },
    })).not.toThrow();
    expect(() => validateDependencyFacts({
      echarts: { version: "6.1.1", license: "Apache-2.0", integrity: "wrong" },
      zrender: { version: "6.1.0", license: "BSD-3-Clause", integrity: "wrong" },
      tslib: { version: "2.3.0", license: "0BSD", integrity: "wrong" },
    })).toThrow();
  });

  it("checks the actual package, lock, notice and static import boundary", async () => {
    await expect(checkFeat128S9bDDependencies()).resolves.toBeUndefined();
  });

  it("does not claim ownership of a legal downstream S9B-R path", () => {
    expect(() => validateProtectedBoundaryFiles([
      "src/components/chat/ChatArtifactReport.vue",
    ])).not.toThrow();
  });

  it("fails closed when an immutable S9B-D production boundary changes", () => {
    expect(() => validateProtectedBoundaryFiles([
      "src/components/yijie/YjChartCard.vue",
    ])).toThrow("immutable S9B-D protected file changed");
    expect(() => validateProtectedBoundaryFiles([
      "tests/visual/feat-128-s9b-d/visual-harness.ts",
    ])).toThrow("immutable S9B-D protected file changed");
  });

  it("fixes the historical readiness-to-S9B-D scope audit", () => {
    expect(() => validateHistoricalScopeFiles([
      "package.json",
      "scripts/check-feat128-s9b-d-dependencies.mjs",
      "tests/visual/feat-128-s9b-d/index.html",
    ])).not.toThrow();
    expect(() => validateHistoricalScopeFiles([
      "src/components/chat/ChatArtifactReport.vue",
    ])).toThrow("historical S9B-D commit changed a forbidden file");
  });
});
