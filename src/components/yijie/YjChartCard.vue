<script setup lang="ts">
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import type {
  ArtifactReportChartModel,
  ArtifactReportChartRenderableModel,
} from "../../domain/chat-artifact-report-chart";
import { createArtifactReportEChartsTheme } from "../../design/theme/echarts-theme";

use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  AriaComponent,
  CanvasRenderer,
]);

const props = defineProps<{
  model: ArtifactReportChartModel;
}>();

const chartElement = ref<HTMLElement | null>(null);
const runtimeFailed = ref(false);
const titleId = useId();
const descriptionId = useId();
let chart: ReturnType<typeof init> | null = null;
let resizeObserver: ResizeObserver | null = null;
let themeObserver: MutationObserver | null = null;
let activeTheme = "";
let disposed = false;
let rebuildEpoch = 0;

function readCssVariable(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

function destroyChart(): void {
  const currentChart = chart;
  chart = null;
  if (currentChart) {
    try {
      currentChart.clear();
    } catch {
      // A failed chart remains isolated to this card; no raw error escapes.
    }
    try {
      currentChart.dispose();
    } catch {
      // Disposal is best effort after a renderer failure.
    }
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function axis(textColor: string, borderColor: string, gridColor: string) {
  return {
    axisLabel: { color: textColor },
    axisLine: { lineStyle: { color: borderColor } },
    axisTick: { lineStyle: { color: borderColor } },
    splitLine: { lineStyle: { color: gridColor } },
  };
}

function fixedOption(model: ArtifactReportChartRenderableModel, palette: readonly string[]) {
  const textColor = readCssVariable("--yj-color-text-secondary").trim();
  const borderColor = readCssVariable("--yj-color-border-default").trim();
  const gridColor = readCssVariable("--yj-color-border-subtle").trim();
  if (!textColor || !borderColor || !gridColor) throw new Error("Missing chart axis token");
  const common = {
    animation: false,
    aria: {
      enabled: true,
      decal: { show: true },
      label: { enabled: true, description: model.description },
    },
    backgroundColor: "transparent",
    color: [...palette],
    grid: { left: 16, right: 16, top: 24, bottom: 32, containLabel: true },
    tooltip: {
      trigger: model.kind === "pie" ? "item" : "axis",
      renderMode: "richText",
      confine: true,
      appendToBody: false,
      enterable: false,
      transitionDuration: 0,
    },
  };

  if (model.kind === "pie") {
    return {
      ...common,
      series: [{
        name: model.series[0]!.name,
        type: "pie",
        radius: ["35%", "68%"],
        center: ["50%", "50%"],
        data: model.categories.map((name, index) => ({
          name,
          value: model.series[0]!.values[index],
        })),
      }],
    };
  }

  return {
    ...common,
    xAxis: {
      type: "category",
      data: [...model.categories],
      ...axis(textColor, borderColor, gridColor),
    },
    yAxis: {
      type: "value",
      ...axis(textColor, borderColor, gridColor),
    },
    series: model.series.map((series) => model.kind === "bar" ? {
      name: series.name,
      type: "bar",
      data: [...series.values],
    } : {
      name: series.name,
      type: "line",
      data: [...series.values],
      symbol: "circle",
      showSymbol: true,
      lineStyle: { width: 2 },
    }),
  };
}

function failCurrentChart(): void {
  runtimeFailed.value = true;
  destroyChart();
}

function createChart(): void {
  if (
    disposed ||
    runtimeFailed.value ||
    props.model.status !== "renderable" ||
    !chartElement.value
  ) return;

  try {
    const theme = createArtifactReportEChartsTheme(readCssVariable);
    chart = init(chartElement.value, theme, { renderer: "canvas" });
    chart.setOption(fixedOption(props.model, theme.color), { notMerge: true, lazyUpdate: false });
    resizeObserver = new ResizeObserver(() => {
      try {
        chart?.resize();
      } catch {
        failCurrentChart();
      }
    });
    resizeObserver.observe(chartElement.value);
  } catch {
    failCurrentChart();
  }
}

async function rebuildChart(): Promise<void> {
  const epoch = ++rebuildEpoch;
  destroyChart();
  runtimeFailed.value = false;
  await nextTick();
  if (epoch !== rebuildEpoch) return;
  createChart();
}

watch(() => props.model, () => {
  void rebuildChart();
});

onMounted(() => {
  activeTheme = document.documentElement.dataset.theme ?? "";
  themeObserver = new MutationObserver(() => {
    const nextTheme = document.documentElement.dataset.theme ?? "";
    if (nextTheme === activeTheme) return;
    activeTheme = nextTheme;
    void rebuildChart();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  createChart();
});

onBeforeUnmount(() => {
  disposed = true;
  rebuildEpoch += 1;
  destroyChart();
  themeObserver?.disconnect();
  themeObserver = null;
});
</script>

<template>
  <article
    class="yj-chart-card"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    aria-busy="false"
    data-testid="yj-chart-card"
  >
    <header class="yj-chart-card__header">
      <div>
        <h3 :id="titleId" class="yj-chart-card__title">{{ model.title }}</h3>
        <p :id="descriptionId" class="yj-chart-card__description">{{ model.description }}</p>
      </div>
      <span class="yj-chart-card__mode yj-badge">图表增强</span>
    </header>

    <p
      v-if="model.status === 'fallback' || runtimeFailed"
      class="yj-chart-card__fallback"
      data-testid="yj-chart-fallback"
      role="status"
      aria-live="polite"
    >
      图表当前不可用，以下表格仍包含本节的权威数据。
    </p>

    <template v-if="model.status === 'renderable'">
      <ul class="yj-chart-card__legend" data-testid="yj-chart-legend" aria-label="数据系列">
        <li v-for="(series, index) in model.series" :key="series.ordinal">
          <span
            class="yj-chart-card__legend-swatch"
            :class="`yj-chart-card__legend-swatch--${(index % 8) + 1}`"
            aria-hidden="true"
          />
          <span>{{ series.name }}</span>
        </li>
      </ul>
      <div
        v-if="!runtimeFailed"
        ref="chartElement"
        class="yj-chart-card__canvas"
        data-testid="yj-chart-canvas"
        role="img"
        :aria-label="`${model.title}。${model.description}`"
      />
    </template>

    <div class="yj-chart-card__table-region" tabindex="0" aria-label="图表数据表格，可横向滚动">
      <table>
        <caption>图表数据</caption>
        <thead>
          <tr>
            <th v-for="(column, columnIndex) in model.table.columns" :key="columnIndex" scope="col">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in model.table.rows" :key="rowIndex">
            <th scope="row">{{ row[0] }}</th>
            <td v-for="(cell, cellIndex) in row.slice(1)" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </article>
</template>

<style scoped>
.yj-chart-card {
  min-width: 0;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: none;
}

.yj-chart-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-4);
}

.yj-chart-card__title {
  margin: 0;
  font-size: var(--yj-font-size-card-title);
  line-height: var(--yj-line-height-card-title);
}

.yj-chart-card__description,
.yj-chart-card__fallback {
  margin: var(--yj-space-1) 0 0;
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.yj-chart-card__mode {
  flex: 0 0 auto;
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
}

.yj-chart-card__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--yj-space-2) var(--yj-space-4);
  padding: 0;
  margin: var(--yj-space-4) 0 var(--yj-space-2);
  color: var(--yj-color-text-primary);
  list-style: none;
}

.yj-chart-card__legend li {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
}

.yj-chart-card__legend-swatch {
  width: var(--yj-space-3);
  height: var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-text-secondary);
  border-radius: var(--yj-radius-xs);
  background-image: repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px);
}

.yj-chart-card__legend-swatch--1 { color: var(--yj-color-chart-series-1); background-color: var(--yj-color-chart-series-1); }
.yj-chart-card__legend-swatch--2 { color: var(--yj-color-chart-series-2); background-color: var(--yj-color-chart-series-2); }
.yj-chart-card__legend-swatch--3 { color: var(--yj-color-chart-series-3); background-color: var(--yj-color-chart-series-3); }
.yj-chart-card__legend-swatch--4 { color: var(--yj-color-chart-series-4); background-color: var(--yj-color-chart-series-4); }
.yj-chart-card__legend-swatch--5 { color: var(--yj-color-chart-series-5); background-color: var(--yj-color-chart-series-5); }
.yj-chart-card__legend-swatch--6 { color: var(--yj-color-chart-series-6); background-color: var(--yj-color-chart-series-6); }
.yj-chart-card__legend-swatch--7 { color: var(--yj-color-chart-series-7); background-color: var(--yj-color-chart-series-7); }
.yj-chart-card__legend-swatch--8 { color: var(--yj-color-chart-series-8); background-color: var(--yj-color-chart-series-8); }

.yj-chart-card__canvas {
  width: 100%;
  height: 280px;
  outline: none;
}

.yj-chart-card__table-region {
  max-width: 100%;
  margin-top: var(--yj-space-4);
  overflow-x: auto;
  border-radius: var(--yj-radius-md);
}

.yj-chart-card__table-region:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: 2px;
}

table {
  width: 100%;
  min-width: 360px;
  border-collapse: collapse;
  color: var(--yj-color-text-primary);
}

caption {
  padding: 0 0 var(--yj-space-2);
  text-align: left;
  font-weight: var(--yj-font-weight-semibold);
}

th,
td {
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  text-align: left;
  white-space: nowrap;
}

thead th {
  background: var(--yj-color-bg-subtle);
}

@media (max-width: 700px) {
  .yj-chart-card { padding: var(--yj-space-3); }
  .yj-chart-card__header { flex-direction: column; }
  .yj-chart-card__canvas { height: 180px; }
}

@media (prefers-reduced-motion: reduce) {
  .yj-chart-card,
  .yj-chart-card * {
    scroll-behavior: auto;
    transition: none;
    animation: none;
  }
}
</style>
