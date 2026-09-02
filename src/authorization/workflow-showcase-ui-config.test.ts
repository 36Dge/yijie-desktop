import { describe, expect, it } from "vitest";
import { isWorkflowShowcaseUiEnabled } from "./workflow-showcase-ui-config";

describe("workflow showcase UI profile", () => {
  it("FEAT-151 enables the static page only for exact local demo_fast", () => {
    expect(isWorkflowShowcaseUiEnabled("local", "demo_fast")).toBe(true);

    for (const [environment, profile] of [
      ["production", "demo_fast"],
      ["local", "production_hardened"],
      ["local", "DEMO_FAST"],
      [undefined, undefined],
    ] as const) {
      expect(isWorkflowShowcaseUiEnabled(environment, profile)).toBe(false);
    }
  });
});
