import { describe, expect, it } from "vitest";
import { isSkillMarketplaceUiEnabled } from "./skill-marketplace-ui-config";

describe("Skill marketplace UI profile", () => {
  it("enables only the exact local demo_fast conjunction", () => {
    expect(isSkillMarketplaceUiEnabled("local", "demo_fast")).toBe(true);
    expect(isSkillMarketplaceUiEnabled("production", "demo_fast")).toBe(false);
    expect(isSkillMarketplaceUiEnabled("local", "DEMO_FAST")).toBe(false);
    expect(isSkillMarketplaceUiEnabled("local", undefined)).toBe(false);
  });
});
