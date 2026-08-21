<script setup lang="ts">
import { nextTick } from "vue";
import type { ChatArtifactReportNativeClient } from "../../../src/api/chat-artifact-report-native-client";
import type {
  ArtifactReportPreviewResult,
  ArtifactReportSection,
} from "../../../src/domain/chat-artifact-report-native";
import type { ChatArtifact } from "../../../src/domain/chat-ipc";
import { createArtifactProjection } from "../../../src/domain/chat-artifact";
import ChatArtifactList from "../../../src/components/chat/ChatArtifactList.vue";

type Fixture = "full-known" | "truncated-unknown" | "fallback-error";

const props = defineProps<{ fixture: Fixture; theme: "light" | "dark" }>();
const SESSION_ID = "019c1a00-0000-7000-8000-000000000931";
const TURN_ID = "019c1a00-0000-7000-8000-000000000932";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000930";

function reportArtifact(): ReturnType<typeof createArtifactProjection> {
  const value: ChatArtifact = {
    artifactId: "019c1a00-0000-7000-8000-000000000933",
    kind: "report",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "strict-local-structured-report.json",
    mediaType: "application/vnd.yijie.report+json;version=1",
    sizeBytes: 4_096,
    localCommittedAt: 1_000,
    expiresAt: 605_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
  };
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze(value));
}

function chart(
  ordinal: number,
  chartType: "bar" | "line" | "pie",
  overrides: Partial<Extract<ArtifactReportSection, { type: "chart" }>> = {},
): Extract<ArtifactReportSection, { type: "chart" }> {
  return {
    ordinal,
    id: `visual-chart-${ordinal}`,
    type: "chart",
    required: false,
    truncated: false,
    title: chartType === "bar" ? "季度订单" : chartType === "line" ? "月度趋势" : "渠道构成",
    chartType,
    labels: ["第一季度", "第二季度", "第三季度", "第四季度"],
    series: [{ ordinal: 0, name: "订单", values: [18, 26, 31, 42] }],
    aligned: true,
    ...overrides,
  };
}

function projection(): ArtifactReportPreviewResult {
  if (props.fixture === "truncated-unknown") {
    return Object.freeze({
      schemaVersion: 1,
      title: "有界截断报告",
      generatedAt: "2026-08-21T08:00:00Z",
      sourceTime: null,
      truncated: true,
      sections: Object.freeze([
        { ordinal: 0, id: "summary", type: "summary", required: true, truncated: true, heading: "摘要", text: "当前仅展示经过 native 校验的有界投影。" },
        { ordinal: 1, id: "wide-table", type: "table", required: false, truncated: true, caption: "较宽数据表", columns: Array.from({ length: 8 }, (_, ordinal) => ({ ordinal, key: `c${ordinal}`, label: `数据列 ${ordinal + 1}` })), rows: [Array.from({ length: 8 }, (_, index) => `安全值 ${index + 1}`)] },
        chart(2, "bar"),
        { ordinal: 3, id: "unknown-private-id", type: "unsupported", required: false, truncated: false },
      ]),
    });
  }

  if (props.fixture === "fallback-error") {
    return Object.freeze({
      schemaVersion: 1,
      title: "图表回落隔离报告",
      generatedAt: "2026-08-21T08:00:00Z",
      sourceTime: "2026-08-20T23:59:59Z",
      truncated: false,
      sections: Object.freeze([
        chart(0, "bar", { aligned: false, series: [{ ordinal: 0, name: "错位数据", values: [18, 26] }] }),
        chart(1, "line"),
        { ordinal: 2, id: "callout", type: "callout", required: false, truncated: false, tone: "warning", title: "回落说明", text: "每个图表独立回落，其他报告区块保持可用。" },
      ]),
    });
  }

  return Object.freeze({
    schemaVersion: 1,
    title: "完整已知区块经营报告",
    generatedAt: "2026-08-21T08:00:00Z",
    sourceTime: "2026-08-20T23:59:59Z",
    truncated: false,
    sections: Object.freeze([
      { ordinal: 0, id: "summary", type: "summary", required: true, truncated: false, heading: "经营摘要", text: "本季度订单与服务质量保持稳定。" },
      { ordinal: 1, id: "metrics", type: "metrics", required: false, truncated: false, items: [{ label: "订单总量", value: 117, unit: "单" }, { label: "满意度", value: "96%", unit: null }] },
      { ordinal: 2, id: "paragraph", type: "paragraph", required: false, truncated: false, heading: "补充说明", text: "报告不推断未提供的单位、来源或时间范围。" },
      { ordinal: 3, id: "table", type: "table", required: false, truncated: false, caption: "季度明细", columns: [{ ordinal: 0, key: "quarter", label: "季度" }, { ordinal: 1, key: "orders", label: "订单" }, { ordinal: 2, key: "refunds", label: "退款" }], rows: [["Q1", 18, 2], ["Q2", 26, 3], ["Q3", 31, 2], ["Q4", 42, 4]] },
      chart(4, "bar"),
      chart(5, "line"),
      chart(6, "pie", { series: [{ ordinal: 0, name: "渠道", values: [18, 26, 31, 42] }] }),
      { ordinal: 7, id: "callout", type: "callout", required: false, truncated: false, tone: "success", title: "结论", text: "权威数值始终保留在可访问表格中。" },
    ]),
  });
}

const reportClient: ChatArtifactReportNativeClient = Object.freeze({
  readReportPreview: async () => projection(),
  saveReport: async () => ({ status: "saved" as const, code: null }),
});

async function toggleTheme(): Promise<void> {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  await nextTick();
}

function evidence() {
  const tableRegions = [...document.querySelectorAll<HTMLElement>(".artifact-report__table-region, .yj-chart-card__table-region")];
  return {
    fixture: props.fixture,
    theme: document.documentElement.dataset.theme,
    viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
    pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    previewOpen: document.querySelector("[data-testid='artifact-report-preview-region']") !== null,
    sections: document.querySelectorAll("[data-section-ordinal]").length,
    cards: document.querySelectorAll("[data-testid='yj-chart-card']").length,
    canvases: document.querySelectorAll("[data-testid='yj-chart-canvas'] canvas").length,
    fallbacks: document.querySelectorAll("[data-testid='yj-chart-fallback']").length,
    visibleTables: document.querySelectorAll("table").length,
    tableLocalOverflow: tableRegions.some((entry) => entry.scrollWidth > entry.clientWidth),
    focusedTestId: document.activeElement?.getAttribute("data-testid") ?? null,
  };
}

declare global {
  interface Window {
    __FEAT128_S9BR_VISUAL__: {
      evidence: typeof evidence;
      toggleTheme: typeof toggleTheme;
    };
  }
}

window.__FEAT128_S9BR_VISUAL__ = { evidence, toggleTheme };
</script>

<template>
  <main class="visual-harness">
    <header class="visual-harness__header">
      <div>
        <p class="visual-harness__eyebrow">FEAT-128 / S9B-R / TEST ONLY</p>
        <h1>Ready report renderer 验证</h1>
        <p>当前为 {{ fixture }} fixture；预览必须由明确用户操作打开。</p>
      </div>
      <button data-testid="theme-toggle" type="button" @click="toggleTheme">切换主题</button>
    </header>
    <section class="visual-harness__content" aria-label="结构化报告视觉验证">
      <ChatArtifactList
        :artifacts="[reportArtifact()]"
        :context-id="CONTEXT_ID"
        :report-native-client="reportClient"
      />
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

.visual-harness__header,
.visual-harness__content {
  width: min(100%, 1080px);
  margin-inline: auto;
}

.visual-harness__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-4);
  margin-bottom: var(--yj-space-6);
}

.visual-harness__eyebrow {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
}

h1,
p { margin: 0 0 var(--yj-space-2); }

button {
  flex: 0 0 auto;
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

@media (max-width: 700px) {
  .visual-harness { padding: var(--yj-space-3); }
  .visual-harness__header { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .visual-harness,
  .visual-harness * {
    scroll-behavior: auto;
    transition: none;
    animation: none;
  }
}
</style>
