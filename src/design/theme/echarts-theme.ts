export type ArtifactReportChartTokenReader = (variableName: string) => string;

export const ARTIFACT_REPORT_CHART_TOKEN_NAMES = Object.freeze([
  "--yj-color-chart-series-1",
  "--yj-color-chart-series-2",
  "--yj-color-chart-series-3",
  "--yj-color-chart-series-4",
  "--yj-color-chart-series-5",
  "--yj-color-chart-series-6",
  "--yj-color-chart-series-7",
  "--yj-color-chart-series-8",
] as const);

export type ArtifactReportEChartsTheme = Readonly<{
  backgroundColor: "transparent";
  color: readonly string[];
  textStyle: Readonly<{ color: string; fontFamily: string }>;
  categoryAxis: Readonly<{
    axisLabel: Readonly<{ color: string }>;
    axisLine: Readonly<{ lineStyle: Readonly<{ color: string }> }>;
    splitLine: Readonly<{ lineStyle: Readonly<{ color: string }> }>;
  }>;
  valueAxis: Readonly<{
    axisLabel: Readonly<{ color: string }>;
    axisLine: Readonly<{ lineStyle: Readonly<{ color: string }> }>;
    splitLine: Readonly<{ lineStyle: Readonly<{ color: string }> }>;
  }>;
  tooltip: Readonly<{
    backgroundColor: string;
    borderColor: string;
    textStyle: Readonly<{ color: string; fontFamily: string }>;
  }>;
}>;

function requiredToken(reader: ArtifactReportChartTokenReader, name: string): string {
  const value = reader(name).trim();
  if (!value) throw new Error(`Missing chart design token: ${name}`);
  return value;
}

export function createArtifactReportEChartsTheme(
  reader: ArtifactReportChartTokenReader,
): ArtifactReportEChartsTheme {
  const token = (name: string) => requiredToken(reader, name);
  const palette = Object.freeze(ARTIFACT_REPORT_CHART_TOKEN_NAMES.map(token));
  const textPrimary = token("--yj-color-text-primary");
  const textSecondary = token("--yj-color-text-secondary");
  const borderDefault = token("--yj-color-border-default");
  const borderSubtle = token("--yj-color-border-subtle");
  const backgroundElevated = token("--yj-color-bg-elevated");
  const fontFamily = token("--yj-font-family-sans");
  const axis = Object.freeze({
    axisLabel: Object.freeze({ color: textSecondary }),
    axisLine: Object.freeze({ lineStyle: Object.freeze({ color: borderDefault }) }),
    splitLine: Object.freeze({ lineStyle: Object.freeze({ color: borderSubtle }) }),
  });

  return Object.freeze({
    backgroundColor: "transparent" as const,
    color: palette,
    textStyle: Object.freeze({ color: textPrimary, fontFamily }),
    categoryAxis: axis,
    valueAxis: axis,
    tooltip: Object.freeze({
      backgroundColor: backgroundElevated,
      borderColor: borderDefault,
      textStyle: Object.freeze({ color: textPrimary, fontFamily }),
    }),
  });
}
