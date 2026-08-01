import { describe, expect, it } from "vitest";
import { isAuthoritativePermissionUiEnabled } from "./permission-ui-config";

describe("authoritative permission UI config", () => {
  it.each([undefined, null, "", "false", "TRUE", "1", true])(
    "CFG-001 keeps the UI fail-closed for %s",
    (value) => {
      expect(isAuthoritativePermissionUiEnabled(value)).toBe(false);
    },
  );

  it("CFG-002 enables the UI only for the exact approved value", () => {
    expect(isAuthoritativePermissionUiEnabled("true")).toBe(true);
  });
});
