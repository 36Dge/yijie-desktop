import { describe, expect, it } from "vitest";
import { createNaiveThemeOverrides } from "./naive-theme";

describe("createNaiveThemeOverrides", () => {
  it("passes resolved token values to Naive UI instead of CSS var expressions", () => {
    const overrides = createNaiveThemeOverrides((name) => {
      const values: Record<string, string> = {
        "--yj-font-family-sans": "system-ui",
        "--yj-color-brand-primary": "#95bf47",
        "--yj-color-brand-hover": "#a3c95c",
        "--yj-color-brand-active": "#7fa33c",
        "--yj-radius-md": "8px",
        "--yj-color-text-primary": "#18230f",
        "--yj-color-text-secondary": "#526046",
        "--yj-color-text-tertiary": "#7a8670",
        "--yj-color-bg-app": "#f7f9f3",
        "--yj-color-bg-card": "#ffffff",
        "--yj-color-bg-elevated": "#ffffff",
        "--yj-color-bg-subtle": "#f1f5ea",
        "--yj-color-border-default": "#d6dec8",
        "--yj-color-border-subtle": "#e6ecdd",
        "--yj-radius-lg": "12px",
        "--yj-space-5": "20px",
        "--yj-radius-sm": "6px",
      };

      return values[name] ?? "";
    });

    expect(overrides.common?.primaryColor).toBe("#95bf47");
    expect(overrides.common?.primaryColor).not.toContain("var(");
    expect(overrides.Card?.paddingMedium).toBe("20px");
  });

  it("fails fast when a required design token is missing", () => {
    expect(() => createNaiveThemeOverrides(() => "")).toThrow(
      "Missing design token: --yj-font-family-sans",
    );
  });
});
