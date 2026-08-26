import { describe, expect, it } from "vitest";
import { isStoreShowcaseUiEnabled } from "./store-showcase-ui-config";

describe("Store showcase UI profile", () => {
  it("opens only for the exact local demo_fast profile", () => {
    expect(isStoreShowcaseUiEnabled("local", "demo_fast")).toBe(true);

    for (const [environment, profile] of [
      ["production", "demo_fast"],
      ["local", "production_hardened"],
      ["local", "DEMO_FAST"],
      [undefined, "demo_fast"],
      ["local", undefined],
    ]) {
      expect(isStoreShowcaseUiEnabled(environment, profile)).toBe(false);
    }
  });
});
