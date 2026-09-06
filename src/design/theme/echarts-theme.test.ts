import { describe, expect, it } from "vitest";
import {
  ARTIFACT_REPORT_CHART_TOKEN_NAMES,
  createArtifactReportEChartsTheme,
} from "./echarts-theme";

const lightPalette = [
  "#4B651D", "#356BEA", "#0E7490", "#7C3AED",
  "#B45309", "#C2410C", "#DC2626", "#475569",
] as const;
const darkPalette = [
  "#C3F35B", "#78A2FF", "#46C7D8", "#A78BFA",
  "#FBBF24", "#FB923C", "#F87171", "#94A3B8",
] as const;

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function tokenReader(overrides: Readonly<Record<string, string>> = {}) {
  const values: Record<string, string> = {
    "--yj-color-text-primary": "#25282b",
    "--yj-color-text-secondary": "#60666e",
    "--yj-color-bg-elevated": "#ffffff",
    "--yj-color-border-default": "#e2e5e8",
    "--yj-color-border-subtle": "#eceef0",
    "--yj-font-family-sans": "system-ui",
    ...Object.fromEntries(ARTIFACT_REPORT_CHART_TOKEN_NAMES.map((name, index) => [name, lightPalette[index]])),
    ...overrides,
  };
  return (name: string) => values[name] ?? "";
}

describe("createArtifactReportEChartsTheme", () => {
  it("resolves only semantic tokens into the exact light palette", () => {
    const theme = createArtifactReportEChartsTheme(tokenReader());

    expect(theme.color).toEqual(lightPalette);
    expect(theme.backgroundColor).toBe("transparent");
    expect(JSON.stringify(theme)).not.toContain("var(");
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.color)).toBe(true);
  });

  it("fails closed when any required token is absent", () => {
    expect(() => createArtifactReportEChartsTheme(tokenReader({
      "--yj-color-chart-series-8": "",
    }))).toThrow("Missing chart design token: --yj-color-chart-series-8");
  });

  it("keeps every light and dark informational series above the 3:1 contrast floor", () => {
    expect(lightPalette.every((color) => contrast(color, "#FFFFFF") >= 3)).toBe(true);
    expect(darkPalette.every((color) => contrast(color, "#25282B") >= 3)).toBe(true);
  });
});
