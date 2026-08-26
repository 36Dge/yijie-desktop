import { describe, expect, it } from "vitest";
import {
  FEAT131_REPLAY_BUNDLE_CANARIES,
  validateFeat131ReplayBundleEntries,
} from "./check-feat131-replay-boundary.mjs";

describe("FEAT-131 production bundle boundary", () => {
  it("accepts ordinary production assets", () => {
    expect(() => validateFeat131ReplayBundleEntries([
      { relativePath: "index.html", bytes: new TextEncoder().encode("<main>易界 AI</main>") },
      { relativePath: "assets/main.js", bytes: new TextEncoder().encode("const ready=true") },
    ])).not.toThrow();
  });

  it("fails closed when a test-only replay marker is bundled", () => {
    for (const canary of FEAT131_REPLAY_BUNDLE_CANARIES) {
      expect(() => validateFeat131ReplayBundleEntries([
        { relativePath: "assets/main.js", bytes: new TextEncoder().encode(canary) },
      ])).toThrow("test-only replay canary entered production bundle");
    }
  });
});
