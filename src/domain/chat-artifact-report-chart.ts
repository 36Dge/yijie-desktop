import type { ArtifactReportSection } from "./chat-artifact-report-native";

export type ArtifactReportChartSection = Extract<ArtifactReportSection, { type: "chart" }>;
export type ArtifactReportChartKind = "bar" | "line" | "pie";
export type ArtifactReportChartFallbackReason =
  | "empty"
  | "unaligned"
  | "pie_series_count"
  | "invalid_bound";
export type ArtifactReportChartTableCell = string | number;

export type ArtifactReportChartTable = Readonly<{
  columns: readonly string[];
  rows: readonly (readonly ArtifactReportChartTableCell[])[];
}>;

export type ArtifactReportChartSeries = Readonly<{
  ordinal: number;
  name: string;
  values: readonly number[];
}>;

type ArtifactReportChartModelBase = Readonly<{
  ordinal: number;
  title: string;
  description: string;
  table: ArtifactReportChartTable;
}>;

export type ArtifactReportChartRenderableModel = ArtifactReportChartModelBase & Readonly<{
  status: "renderable";
  kind: ArtifactReportChartKind;
  categories: readonly string[];
  series: readonly ArtifactReportChartSeries[];
  pointCount: number;
}>;

export type ArtifactReportChartFallbackModel = ArtifactReportChartModelBase & Readonly<{
  status: "fallback";
  reason: ArtifactReportChartFallbackReason;
  pointCount: 0;
}>;

export type ArtifactReportChartModel =
  | ArtifactReportChartRenderableModel
  | ArtifactReportChartFallbackModel;

export type ArtifactReportChartBudgetCandidate = Readonly<{
  ordinal: number;
  model: ArtifactReportChartModel;
}>;

export type ArtifactReportChartBudgetSelection = Readonly<{
  ordinal: number;
  pointCount: number;
}>;

const MAX_BAR_LINE_LABELS = 64;
const MAX_SERIES = 8;
const MAX_PIE_LABELS = 32;
const MAX_POINTS = 512;
const MAX_ENHANCED_CHARTS = 4;
const MAX_ENHANCED_POINTS = 2_048;

function frozenTable(section: ArtifactReportChartSection): ArtifactReportChartTable {
  const rowCount = Math.max(
    section.labels.length,
    ...section.series.map((series) => series.values.length),
    0,
  );
  const columns = Object.freeze(["分类", ...section.series.map((series) => series.name)]);
  const rows = Object.freeze(Array.from({ length: rowCount }, (_, index) => Object.freeze([
    section.labels[index] ?? `第 ${index + 1} 项（缺少标签）`,
    ...section.series.map((series) => series.values[index] ?? "—"),
  ])));
  return Object.freeze({ columns, rows });
}

function chartTitle(section: ArtifactReportChartSection): string {
  return section.title?.trim() || "报告图表";
}

function description(kind: ArtifactReportChartKind, labels: number, series: number): string {
  const kindLabel = kind === "bar" ? "柱状图" : kind === "line" ? "折线图" : "饼图";
  return `${kindLabel}，${labels} 个分类，${series} 个系列。详细数值见下方表格。`;
}

function fallback(
  section: ArtifactReportChartSection,
  reason: ArtifactReportChartFallbackReason,
  table: ArtifactReportChartTable,
): ArtifactReportChartFallbackModel {
  return Object.freeze({
    status: "fallback" as const,
    reason,
    ordinal: section.ordinal,
    title: chartTitle(section),
    description: "图表不可安全增强，已保留完整文本表格。",
    table,
    pointCount: 0 as const,
  });
}

export function createArtifactReportChartModel(
  section: ArtifactReportChartSection,
): ArtifactReportChartModel {
  const table = frozenTable(section);
  const kind = section.chartType as string;
  if (kind !== "bar" && kind !== "line" && kind !== "pie") {
    return fallback(section, "invalid_bound", table);
  }
  const labelLimit = kind === "pie" ? MAX_PIE_LABELS : MAX_BAR_LINE_LABELS;
  const pointCount = section.series.reduce((total, series) => total + series.values.length, 0);
  const finite = section.series.every((series) => series.values.every(Number.isFinite));
  const actuallyAligned = section.series.every((series) => series.values.length === section.labels.length);

  if (section.labels.length === 0 || section.series.length === 0) {
    return fallback(section, "empty", table);
  }
  if (!section.aligned || !actuallyAligned) {
    return fallback(section, "unaligned", table);
  }
  if (
    section.labels.length > labelLimit ||
    section.series.length > MAX_SERIES ||
    pointCount > MAX_POINTS ||
    !finite
  ) {
    return fallback(section, "invalid_bound", table);
  }
  if (kind === "pie" && section.series.length !== 1) {
    return fallback(section, "pie_series_count", table);
  }
  if (
    kind === "pie" &&
    (section.series[0]!.values.some((value) => value < 0) ||
      !section.series[0]!.values.some((value) => value > 0))
  ) {
    return fallback(section, "invalid_bound", table);
  }

  const categories = Object.freeze([...section.labels]);
  const series = Object.freeze(section.series.map((item) => Object.freeze({
    ordinal: item.ordinal,
    name: item.name,
    values: Object.freeze([...item.values]),
  })));
  return Object.freeze({
    status: "renderable" as const,
    ordinal: section.ordinal,
    title: chartTitle(section),
    description: description(kind, categories.length, series.length),
    kind,
    categories,
    series,
    table,
    pointCount,
  });
}

export function selectArtifactReportChartEnhancements(
  candidates: readonly ArtifactReportChartBudgetCandidate[],
): readonly ArtifactReportChartBudgetSelection[] {
  const eligible = candidates
    .filter((candidate): candidate is Readonly<{
      ordinal: number;
      model: ArtifactReportChartRenderableModel;
    }> => candidate.model.status === "renderable")
    .map((candidate, inputIndex) => ({ ...candidate, inputIndex }))
    .sort((left, right) => left.ordinal - right.ordinal || left.inputIndex - right.inputIndex);

  let totalPoints = 0;
  const selected: ArtifactReportChartBudgetSelection[] = [];
  for (const candidate of eligible) {
    if (selected.length === MAX_ENHANCED_CHARTS) break;
    if (totalPoints + candidate.model.pointCount > MAX_ENHANCED_POINTS) continue;
    totalPoints += candidate.model.pointCount;
    selected.push(Object.freeze({ ordinal: candidate.ordinal, pointCount: candidate.model.pointCount }));
  }
  return Object.freeze(selected);
}
