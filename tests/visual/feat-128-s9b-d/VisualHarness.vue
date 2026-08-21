<script setup lang="ts">
import { computed, nextTick } from "vue";
import YjChartCard from "../../../src/components/yijie/YjChartCard.vue";
import {
  createArtifactReportChartModel,
  type ArtifactReportChartModel,
} from "../../../src/domain/chat-artifact-report-chart";
import type { ArtifactReportSection } from "../../../src/domain/chat-artifact-report-native";

type Chart = Extract<ArtifactReportSection, { type: "chart" }>;
type Fixture = "full" | "fallback" | "error";

const props = defineProps<{ fixture: Fixture; theme: "light" | "dark" }>();

function chart(overrides: Partial<Chart> = {}): Chart {
  return {
    ordinal: 0,
    id: "visual-chart",
    type: "chart",
    required: false,
    truncated: false,
    title: "季度经营指标",
    chartType: "bar",
    labels: ["第一季度", "第二季度", "第三季度", "第四季度"],
    series: [
      { ordinal: 0, name: "订单数量", values: [18, 26, 31, 42] },
      { ordinal: 1, name: "退款数量", values: [2, 3, 2, 4] },
    ],
    aligned: true,
    ...overrides,
  };
}

const models = computed<readonly ArtifactReportChartModel[]>(() => {
  if (props.fixture === "fallback") {
    return [createArtifactReportChartModel(chart({
      aligned: false,
      labels: ["第一季度"],
      series: [
        { ordinal: 0, name: "订单数量", values: [18, 26] },
        { ordinal: 1, name: "退款数量", values: [2] },
      ],
    }))];
  }
  if (props.fixture === "error") {
    return [createArtifactReportChartModel(chart({
      series: [{ ordinal: 0, name: "无效数值", values: [Number.NaN, 1, 2, 3] }],
    }))];
  }
  return [
    createArtifactReportChartModel(chart()),
    createArtifactReportChartModel(chart({
      ordinal: 1,
      id: "visual-line",
      title: "月度趋势",
      chartType: "line",
    })),
    createArtifactReportChartModel(chart({
      ordinal: 2,
      id: "visual-pie",
      title: "订单构成",
      chartType: "pie",
      series: [{ ordinal: 0, name: "订单数量", values: [18, 26, 31, 42] }],
    })),
  ];
});

async function toggleTheme() {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  await nextTick();
}

function evidence() {
  const cards = [...document.querySelectorAll<HTMLElement>("[data-testid='yj-chart-card']")];
  const tables = [...document.querySelectorAll<HTMLElement>(".yj-chart-card__table-region")];
  return {
    fixture: props.fixture,
    theme: document.documentElement.dataset.theme,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    cards: cards.length,
    canvases: document.querySelectorAll("canvas").length,
    fallbacks: document.querySelectorAll("[data-testid='yj-chart-fallback']").length,
    visibleTables: document.querySelectorAll("table").length,
    tableLocalOverflow: tables.some((table) => table.scrollWidth > table.clientWidth),
    focusedTestId: document.activeElement?.getAttribute("data-testid") ?? null,
  };
}

declare global {
  interface Window {
    __FEAT128_S9BD_VISUAL__: {
      evidence: typeof evidence;
      toggleTheme: typeof toggleTheme;
    };
  }
}

window.__FEAT128_S9BD_VISUAL__ = { evidence, toggleTheme };
</script>

<template>
  <main class="visual-harness">
    <header class="visual-harness__header">
      <div>
        <p class="visual-harness__eyebrow">FEAT-128 / S9B-D / TEST ONLY</p>
        <h1>结构化报告图表基础验证</h1>
        <p>当前为 {{ fixture }} fixture；数据表格始终是权威内容。</p>
      </div>
      <button data-testid="theme-toggle" type="button" @click="toggleTheme">切换主题</button>
    </header>
    <section class="visual-harness__grid" aria-label="图表卡片视觉矩阵">
      <YjChartCard v-for="model in models" :key="model.ordinal" :model="model" />
    </section>
  </main>
</template>

<style scoped>
.visual-harness {
  min-height: 100vh;
  padding: var(--yj-space-6);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.visual-harness__header {
  display: flex;
  max-width: 1080px;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-4);
  margin: 0 auto var(--yj-space-6);
}

.visual-harness__eyebrow {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
}

h1,
p { margin: 0 0 var(--yj-space-2); }

button {
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-strong);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

button:focus-visible {
  outline: 3px solid var(--yj-color-brand-primary);
  outline-offset: 2px;
}

.visual-harness__grid {
  display: grid;
  max-width: 1080px;
  gap: var(--yj-space-6);
  margin: 0 auto;
}

@media (max-width: 700px) {
  .visual-harness { padding: var(--yj-space-3); }
  .visual-harness__header { flex-direction: column; }
}
</style>
