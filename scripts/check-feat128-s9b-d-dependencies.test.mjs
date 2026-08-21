import { describe, expect, it } from "vitest";
import {
  checkFeat128S9bDDependencies,
  validateDependencyFacts,
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
});
