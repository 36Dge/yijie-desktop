import { describe, expect, it } from "vitest";
import { isLocalWhitelistLoginEnabled } from "./local-whitelist-login-config";

describe("local whitelist login configuration", () => {
  it.each([
    [undefined, "local"],
    ["true", undefined],
    ["true", "production"],
    ["true", "LOCAL"],
    ["", "local"],
    ["false", "local"],
    ["TRUE", "local"],
    [true, "local"],
    [1, "local"],
  ])("keeps the local credential form closed for %j/%j", (value, environment) => {
    expect(isLocalWhitelistLoginEnabled(value, environment)).toBe(false);
  });

  it("opens the local credential form only for exact true", () => {
    expect(isLocalWhitelistLoginEnabled("true", "local")).toBe(true);
  });
});
