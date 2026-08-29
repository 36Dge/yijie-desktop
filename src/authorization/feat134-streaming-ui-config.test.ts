import { describe, expect, it } from "vitest";
import { isFeat134StreamingUiEnabled } from "./feat134-streaming-ui-config";

describe("FEAT-134 streaming UI gate", () => {
  it("enables only the exact local demo_fast conjunction", () => {
    expect(isFeat134StreamingUiEnabled("local", "demo_fast", "true")).toBe(true);
  });

  it.each([
    ["production", "demo_fast", "true"],
    ["local", "public", "true"],
    ["local", "demo_fast", "false"],
    ["local", "demo_fast", undefined],
    ["LOCAL", "demo_fast", "true"],
    ["local", "DEMO_FAST", "true"],
  ])("stays disabled for environment=%s profile=%s flag=%s", (environment, profile, flag) => {
    expect(isFeat134StreamingUiEnabled(environment, profile, flag)).toBe(false);
  });
});
