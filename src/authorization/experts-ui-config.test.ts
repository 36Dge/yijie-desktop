import { describe, expect, it } from "vitest";
import { isExpertsUiEnabled } from "./experts-ui-config";

describe("expert candidate UI gate", () => {
  it("requires the explicit local demo flag and never enables by default", () => {
    expect(isExpertsUiEnabled("local", "demo_fast", "true")).toBe(true);
    expect(isExpertsUiEnabled("local", "demo_fast", undefined)).toBe(false);
    expect(isExpertsUiEnabled("production", "demo_fast", "true")).toBe(false);
    expect(isExpertsUiEnabled("local", "production_hardened", "true")).toBe(false);
  });
});
