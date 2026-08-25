import { describe, expect, it } from "vitest";
import { isDemoFastLocalProfile, shouldResetDemoFastStartupPath } from "./local-profile";

describe("local runtime profile", () => {
  it("enables demo_fast only for the exact local profile", () => {
    expect(isDemoFastLocalProfile("local", "demo_fast")).toBe(true);

    for (const [environment, profile] of [
      [undefined, undefined],
      ["local", undefined],
      ["local", "production_hardened"],
      ["production", "demo_fast"],
      ["LOCAL", "demo_fast"],
      ["local", "DEMO_FAST"],
    ]) {
      expect(isDemoFastLocalProfile(environment, profile)).toBe(false);
    }
  });

  it("resets a restored Desktop path only for demo_fast startup", () => {
    expect(shouldResetDemoFastStartupPath(true, "/settings")).toBe(true);
    expect(shouldResetDemoFastStartupPath(true, "/chat/existing-session")).toBe(true);
    expect(shouldResetDemoFastStartupPath(true, "/")).toBe(false);
    expect(shouldResetDemoFastStartupPath(false, "/settings")).toBe(false);
  });
});
