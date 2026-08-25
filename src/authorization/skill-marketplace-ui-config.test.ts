import { describe, expect, it } from "vitest";
import { isSkillMarketplaceUiEnabled } from "./skill-marketplace-ui-config";

describe("Skill marketplace UI profile", () => {
  it("enables the exact local demo_fast conjunction without an explicit flag", () => {
    expect(isSkillMarketplaceUiEnabled("local", "demo_fast")).toBe(true);
    expect(isSkillMarketplaceUiEnabled("production", "demo_fast")).toBe(false);
    expect(isSkillMarketplaceUiEnabled("local", "DEMO_FAST")).toBe(false);
    expect(isSkillMarketplaceUiEnabled("local", undefined)).toBe(false);
  });

  it("enables any build profile only when the explicit flag is exactly true", () => {
    expect(isSkillMarketplaceUiEnabled("production", undefined, "true")).toBe(
      true,
    );
    expect(
      isSkillMarketplaceUiEnabled("production", "production_hardened", "true"),
    ).toBe(true);

    for (const flag of [undefined, "", "false", "TRUE", "1", true]) {
      expect(
        isSkillMarketplaceUiEnabled(
          "production",
          "production_hardened",
          flag,
        ),
      ).toBe(false);
    }
  });

  it("does not let an explicit false value disable exact local demo_fast", () => {
    expect(isSkillMarketplaceUiEnabled("local", "demo_fast", "false")).toBe(
      true,
    );
  });
});
