import { describe, expect, it } from "vitest";
import type { ArtifactReportSection } from "./chat-artifact-report-native";
import {
  createArtifactReportChartModel,
  selectArtifactReportChartEnhancements,
} from "./chat-artifact-report-chart";

type ChartSection = Extract<ArtifactReportSection, { type: "chart" }>;

function chart(overrides: Partial<ChartSection> = {}): ChartSection {
  return {
    ordinal: 2,
    id: "chart-2",
    type: "chart",
    required: false,
    truncated: false,
    title: "季度趋势",
    chartType: "bar",
    labels: ["Q1", "Q2"],
    series: [{ ordinal: 0, name: "订单", values: [12, 18] }],
    aligned: true,
    ...overrides,
  };
}

describe("createArtifactReportChartModel", () => {
  it("maps bounded bar, line and single-series pie charts to deeply frozen models", () => {
    const bar = createArtifactReportChartModel(chart());
    const line = createArtifactReportChartModel(chart({ chartType: "line" }));
    const pie = createArtifactReportChartModel(chart({ chartType: "pie" }));

    for (const model of [bar, line, pie]) {
      expect(model.status).toBe("renderable");
      expect(model.table.rows).toHaveLength(2);
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.table.rows)).toBe(true);
    }
  });

  it("falls back without dropping mismatched table values", () => {
    const model = createArtifactReportChartModel(chart({
      aligned: false,
      labels: ["Q1"],
      series: [
        { ordinal: 0, name: "订单", values: [12, 18] },
        { ordinal: 1, name: "退款", values: [1] },
      ],
    }));

    expect(model.status).toBe("fallback");
    expect(model.status === "fallback" && model.reason).toBe("unaligned");
    expect(model.table.rows).toEqual([
      ["Q1", 12, 1],
      ["第 2 项（缺少标签）", 18, "—"],
    ]);
  });

  it("rejects empty, non-finite, oversize and ineligible pie enhancement", () => {
    expect(createArtifactReportChartModel(chart({ labels: [], series: [] })).status).toBe("fallback");
    expect(createArtifactReportChartModel(chart({
      series: [{ ordinal: 0, name: "订单", values: [Number.NaN, 1] }],
    })).status).toBe("fallback");
    expect(createArtifactReportChartModel(chart({
      labels: Array.from({ length: 65 }, (_, index) => `L${index}`),
      series: [{ ordinal: 0, name: "订单", values: Array.from({ length: 65 }, () => 1) }],
    })).status).toBe("fallback");
    expect(createArtifactReportChartModel(chart({
      chartType: "pie",
      series: [
        { ordinal: 0, name: "订单", values: [1, 2] },
        { ordinal: 1, name: "退款", values: [0, 1] },
      ],
    })).status).toBe("fallback");
    expect(createArtifactReportChartModel(chart({
      chartType: "pie",
      series: [{ ordinal: 0, name: "订单", values: [0, 0] }],
    })).status).toBe("fallback");
    expect(createArtifactReportChartModel(chart({
      chartType: "scatter" as "bar",
    })).status).toBe("fallback");
  });
});

describe("selectArtifactReportChartEnhancements", () => {
  it("allocates a pure per-open budget by section ordinal, never input order", () => {
    const candidates = [5, 1, 4, 0, 3, 2].map((ordinal) => ({
      ordinal,
      model: createArtifactReportChartModel(chart({ ordinal, id: `chart-${ordinal}` })),
    }));

    const selected = selectArtifactReportChartEnhancements(candidates);
    expect(selected.map((entry) => entry.ordinal)).toEqual([0, 1, 2, 3]);
    expect(selected.reduce((total, entry) => total + entry.pointCount, 0)).toBeLessThanOrEqual(2_048);
    expect(Object.isFrozen(selected)).toBe(true);
  });
});
