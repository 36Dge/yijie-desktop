import { describe, expect, it } from "vitest";
import { isFeat137ApprovalUiEnabled } from "./feat137-approval-ui-config";

describe("FEAT-137 approval UI gate", () => {
  it("enables only for the exact local demo_fast conjunction after FEAT-136", () => {
    expect(isFeat137ApprovalUiEnabled("local", "demo_fast", "true", true)).toBe(true);
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
    "stays disabled for environment=%s profile=%s flag=%s feat136=%s",
    (environment, profile, flag, feat136Enabled) => {
      expect(isFeat137ApprovalUiEnabled(
        environment,
        profile,
        flag,
        feat136Enabled as boolean,
      )).toBe(false);
    },
  );
});
