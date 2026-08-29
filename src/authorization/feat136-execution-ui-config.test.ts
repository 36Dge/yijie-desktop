import { describe, expect, it } from "vitest";
import { isFeat136ExecutionUiEnabled } from "./feat136-execution-ui-config";

describe("FEAT-136 execution UI gate", () => {
  it("enables only for the exact local demo_fast conjunction after FEAT-134", () => {
    expect(isFeat136ExecutionUiEnabled("local", "demo_fast", "true", true)).toBe(true);
  });

  it.each([
    ["production", "demo_fast", "true", true],
    ["local", "public", "true", true],
    ["local", "demo_fast", "false", true],
    ["local", "demo_fast", undefined, true],
    ["local", "demo_fast", "true", false],
    ["LOCAL", "demo_fast", "true", true],
    ["local", "DEMO_FAST", "true", true],
  ])(
    "stays disabled for environment=%s profile=%s flag=%s feat134=%s",
    (environment, profile, flag, feat134Enabled) => {
      expect(isFeat136ExecutionUiEnabled(
        environment,
        profile,
        flag,
        feat134Enabled as boolean,
      )).toBe(false);
    },
  );
});
