import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("ECharts compatibility with the normal Tauri prototype policy", () => {
  it("loads the installed ESM modules and renders SVG while Object.prototype stays frozen", () => {
    // Use an independent ordinary process: Tauri freezes Object.prototype before
    // application modules load. Do not freeze the shared Vitest runtime or alter
    // the executable, dependency files, or the application's security policy.
    const source = `
      import assert from "node:assert/strict";

      Object.freeze(Object.prototype);
      assert.equal(Object.isFrozen(Object.prototype), true);
      const [{ init, use }, charts, components, { SVGRenderer }] = await Promise.all([
        import("echarts/core.js"),
        import("echarts/charts.js"),
        import("echarts/components.js"),
        import("echarts/renderers.js"),
      ]);
      use([
        charts.LineChart, charts.BarChart, charts.PieChart,
        charts.RadarChart, charts.ScatterChart,
        components.GridComponent, components.RadarComponent,
        components.LegendComponent, components.TooltipComponent,
        SVGRenderer,
      ]);
      const options = [
        ["line", { xAxis: { type: "category", data: ["A", "B", "C"] }, yAxis: {}, series: [{ type: "line", data: [12, 18, 24] }] }],
        ["bar", { xAxis: { type: "category", data: ["A", "B"] }, yAxis: {}, series: [{ type: "bar", data: [20, 36] }] }],
        ["pie", { series: [{ type: "pie", data: [{ name: "Direct", value: 58 }, { name: "Advertising", value: 42 }] }] }],
        ["radar", { radar: { indicator: [{ name: "Content", max: 100 }, { name: "Ads", max: 100 }, { name: "Reviews", max: 100 }] }, series: [{ type: "radar", data: [{ value: [92, 78, 64] }] }] }],
        ["scatter", { xAxis: {}, yAxis: {}, series: [{ type: "scatter", data: [[1.2, 24], [2.8, 19]] }] }],
      ];
      const rendered = [];
      for (const [kind, option] of options) {
        const chart = init(null, null, { renderer: "svg", ssr: true, width: 420, height: 260 });
        try {
          chart.setOption({ animation: false, ...option });
          const svg = chart.renderToSVGString();
          assert.match(svg, /^<svg\\b/);
          assert.match(svg, /<(path|rect|circle|polygon|polyline)\\b/);
          assert.equal(Object.isFrozen(Object.prototype), true);
          rendered.push({ kind, svgLength: svg.length });
        } finally {
          chart.dispose();
        }
      }
      assert.equal(Object.isFrozen(Object.prototype), true);
      process.stdout.write(JSON.stringify({ frozen: true, rendered }));
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.frozen).toBe(true);
    expect(report.rendered.map((item) => item.kind)).toEqual(["line", "bar", "pie", "radar", "scatter"]);
    expect(report.rendered.every((item) => item.svgLength > 100)).toBe(true);
  });
});
