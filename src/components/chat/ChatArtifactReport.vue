<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, type Component, watch } from "vue";
import {
  ChatArtifactReportNativeClientError,
  type ChatArtifactReportNativeClient,
} from "../../api/chat-artifact-report-native-client";
import type {
  ArtifactReportNativeErrorCode,
  ArtifactReportNativeIdentity,
  ArtifactReportPreviewResult,
  ArtifactReportScalar,
} from "../../domain/chat-artifact-report-native";
import {
  createArtifactReportChartModel,
  selectArtifactReportChartEnhancements,
  type ArtifactReportChartFallbackModel,
  type ArtifactReportChartModel,
} from "../../domain/chat-artifact-report-chart";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import YjIcon from "../yijie/YjIcon.vue";
import { loadChatArtifactReportChartRenderer } from "./chat-artifact-report-chart-renderer";

type PreviewPhase = "idle" | "loading" | "previewed" | "error";
type SafeError = Readonly<{ message: string; retryable: boolean }>;
type SaveTone = "success" | "muted" | "error";
type ChartDisplay = Readonly<{
  model: ArtifactReportChartModel;
  budgetExhausted: boolean;
}>;

const props = defineProps<{
  artifact: ArtifactProjection;
  contextId: string;
  client?: ChatArtifactReportNativeClient;
}>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const eligible = computed(() => props.artifact.kind === "report" && props.artifact.status === "ready");
const available = computed(() => eligible.value && props.client !== undefined && UUID.test(props.contextId));
const identity = computed<ArtifactReportNativeIdentity>(() => Object.freeze({
  sessionId: props.artifact.sessionId,
  turnId: props.artifact.turnId,
  artifactId: props.artifact.artifactId,
}));
const identityKey = computed(() => [
  props.contextId,
  props.artifact.sessionId,
  props.artifact.turnId,
  props.artifact.artifactId,
  props.artifact.kind,
  props.artifact.status,
].join(":"));
const previewTitleId = computed(() => `artifact-report-${props.artifact.artifactId}-preview-title`);

const phase = ref<PreviewPhase>("idle");
const projection = ref<ArtifactReportPreviewResult | null>(null);
const previewError = ref<SafeError | null>(null);
const previewTrigger = ref<HTMLButtonElement | null>(null);
const previewRegion = ref<HTMLElement | null>(null);
const chartRenderer = shallowRef<Component>();
const chartRendererUnavailable = ref(false);
const saving = ref(false);
const saveFeedback = ref<string | null>(null);
const saveTone = ref<SaveTone>("muted");
let identityEpoch = 0;
let previewRequest = 0;
let saveRequest = 0;
let disposed = false;
let chartRendererLoadStarted = false;

const busy = computed(() => phase.value === "loading");

function budgetFallback(model: Extract<ArtifactReportChartModel, { status: "renderable" }>): ArtifactReportChartFallbackModel {
  return Object.freeze({
    status: "fallback" as const,
    reason: "invalid_bound" as const,
    ordinal: model.ordinal,
    title: model.title,
    description: "本次报告已达到安全图表增强上限，权威数据保留在下方表格中。",
    table: model.table,
    pointCount: 0 as const,
  });
}

const chartDisplays = computed<ReadonlyMap<number, ChartDisplay>>(() => {
  const report = projection.value;
  if (!report) return new Map();
  const candidates = report.sections
    .filter((entry) => entry.type === "chart")
    .map((entry) => Object.freeze({
      ordinal: entry.ordinal,
      model: createArtifactReportChartModel(entry),
    }));
  const selected = new Set(selectArtifactReportChartEnhancements(candidates).map((entry) => entry.ordinal));
  return new Map(candidates.map((candidate) => {
    const exhausted = candidate.model.status === "renderable" && !selected.has(candidate.ordinal);
    return [candidate.ordinal, Object.freeze({
      model: exhausted ? budgetFallback(candidate.model) : candidate.model,
      budgetExhausted: exhausted,
    })];
  }));
});

function chartDisplay(ordinal: number): ChartDisplay | undefined {
  return chartDisplays.value.get(ordinal);
}

function chartRendererStatus(display: ChartDisplay): "loading" | "unavailable" | "not-applicable" {
  if (display.model.status !== "renderable") return "not-applicable";
  return chartRendererUnavailable.value ? "unavailable" : "loading";
}

function chartFallbackMessage(display: ChartDisplay): string {
  if (display.model.status !== "renderable") return "本节仅展示权威表格。";
  return chartRendererUnavailable.value
    ? "图表增强不可用，以下表格仍包含本节的权威数据。"
    : "图表增强正在准备，以下表格已可阅读。";
}

function loadChartRendererIfNeeded(): void {
  if (
    chartRendererLoadStarted ||
    chartRenderer.value !== undefined ||
    chartRendererUnavailable.value ||
    ![...chartDisplays.value.values()].some((display) => display.model.status === "renderable")
  ) return;
  chartRendererLoadStarted = true;
  void loadChatArtifactReportChartRenderer()
    .then((renderer) => {
      if (!disposed) chartRenderer.value = renderer;
    })
    .catch(() => {
      if (!disposed) chartRendererUnavailable.value = true;
    });
}

function scalar(value: ArtifactReportScalar): string {
  if (value === null) return "—";
  if (value === true) return "是";
  if (value === false) return "否";
  return String(value);
}

function nativeError(error: unknown): ArtifactReportNativeErrorCode {
  return error instanceof ChatArtifactReportNativeClientError
    ? error.shape.code
    : "artifact_native_unavailable";
}

function safePreviewError(code: ArtifactReportNativeErrorCode): SafeError {
  switch (code) {
    case "artifact_native_expired": return { message: "报告已过期，无法预览。", retryable: false };
    case "artifact_native_not_found": return { message: "报告内容不可用。", retryable: false };
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return { message: "当前没有权限预览这个报告。", retryable: false };
    case "artifact_native_not_ready": return { message: "报告尚未就绪，无法预览。", retryable: false };
    case "artifact_native_unsupported": return { message: "当前报告格式不支持安全预览。", retryable: false };
    case "artifact_native_integrity_failed": return { message: "报告校验失败，无法安全预览。", retryable: false };
    case "artifact_native_limit_exceeded": return { message: "报告超出安全预览范围。", retryable: false };
    case "artifact_native_conflict": return { message: "报告预览正忙，请稍后重试。", retryable: true };
    default: return { message: "报告暂时无法预览，请稍后重试。", retryable: true };
  }
}

function safeSaveMessage(code: ArtifactReportNativeErrorCode): string {
  switch (code) {
    case "artifact_native_expired": return "报告已过期，无法保存。";
    case "artifact_native_not_found": return "报告内容不可用。";
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return "当前没有权限保存报告。";
    case "artifact_native_extension_mismatch": return "保存格式与报告不匹配。";
    case "artifact_native_dialog_unavailable": return "暂时无法打开保存窗口。";
    case "artifact_native_permission_denied": return "没有权限保存报告。";
    case "artifact_native_storage_full": return "存储空间不足，报告未保存。";
    case "artifact_native_integrity_failed": return "报告校验失败，未执行保存。";
    case "artifact_native_conflict": return "另一个报告操作正在进行。";
    default: return "报告保存失败，请稍后重试。";
  }
}

function clearAuthorizedContent(): void {
  projection.value = null;
}

function clearFeedback(): void {
  previewError.value = null;
  saveFeedback.value = null;
  saveTone.value = "muted";
}

async function openPreview(): Promise<void> {
  const issuingClient = props.client;
  if (!available.value || !issuingClient || phase.value === "loading" || phase.value === "previewed") return;
  const request = ++previewRequest;
  const epoch = identityEpoch;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  clearAuthorizedContent();
  clearFeedback();
  phase.value = "loading";
  try {
    const result = await issuingClient.readReportPreview(contextId, issuingIdentity);
    if (disposed || request !== previewRequest || epoch !== identityEpoch || !available.value) return;
    projection.value = result;
    phase.value = "previewed";
    loadChartRendererIfNeeded();
    await nextTick();
    previewRegion.value?.focus();
  } catch (error: unknown) {
    if (disposed || request !== previewRequest || epoch !== identityEpoch) return;
    clearAuthorizedContent();
    saveFeedback.value = null;
    previewError.value = safePreviewError(nativeError(error));
    phase.value = "error";
  }
}

async function retryPreview(): Promise<void> {
  if (!previewError.value?.retryable || busy.value) return;
  phase.value = "idle";
  await openPreview();
}

async function closePreview(): Promise<void> {
  ++identityEpoch;
  ++previewRequest;
  clearAuthorizedContent();
  clearFeedback();
  phase.value = "idle";
  await nextTick();
  previewTrigger.value?.focus();
}

async function saveReport(): Promise<void> {
  const issuingClient = props.client;
  if (!available.value || !issuingClient || saving.value) return;
  const request = ++saveRequest;
  const epoch = identityEpoch;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  saving.value = true;
  saveFeedback.value = "正在打开原生保存窗口…";
  saveTone.value = "muted";
  try {
    const result = await issuingClient.saveReport(contextId, issuingIdentity);
    if (disposed || request !== saveRequest || epoch !== identityEpoch || !available.value) return;
    if (result.status === "saved") {
      saveFeedback.value = "报告 JSON 已保存。";
      saveTone.value = "success";
    } else if (result.status === "cancelled") {
      saveFeedback.value = "已取消保存。";
      saveTone.value = "muted";
    } else {
      saveFeedback.value = safeSaveMessage(result.code ?? "artifact_native_unavailable");
      saveTone.value = "error";
    }
  } catch (error: unknown) {
    if (disposed || request !== saveRequest || epoch !== identityEpoch) return;
    saveFeedback.value = safeSaveMessage(nativeError(error));
    saveTone.value = "error";
  } finally {
    if (!disposed && request === saveRequest) saving.value = false;
  }
}

function replaceIdentity(): void {
  ++identityEpoch;
  ++previewRequest;
  ++saveRequest;
  clearAuthorizedContent();
  clearFeedback();
  phase.value = "idle";
  saving.value = false;
}

watch(identityKey, replaceIdentity);

onBeforeUnmount(() => {
  disposed = true;
  ++identityEpoch;
  ++previewRequest;
  ++saveRequest;
  clearAuthorizedContent();
  clearFeedback();
});
</script>

<template>
  <section
    v-if="eligible"
    class="artifact-report"
    data-testid="artifact-report"
    aria-label="结构化报告预览与保存"
    :aria-busy="busy ? 'true' : 'false'"
  >
    <div v-if="available" class="artifact-report__actions">
      <button
        ref="previewTrigger"
        data-testid="artifact-report-open"
        type="button"
        :disabled="busy || phase === 'previewed'"
        :aria-expanded="phase === 'previewed' ? 'true' : 'false'"
        @click="openPreview"
      >
        <YjIcon name="file" size="sm" />
        {{ busy ? "预览中" : "预览报告" }}
      </button>
      <button
        data-testid="artifact-report-save"
        type="button"
        :disabled="saving"
        aria-label="保存报告 JSON"
        @click="saveReport"
      >
        <YjIcon name="download" size="sm" />
        {{ saving ? "保存中" : "保存 JSON" }}
      </button>
    </div>
    <p v-else class="artifact-report__unavailable" role="note">报告预览与保存暂不可用。</p>

    <p
      v-if="busy"
      class="artifact-report__state"
      data-testid="artifact-report-state"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >正在读取安全报告预览…</p>

    <div v-else-if="previewError" class="artifact-report__error" role="alert">
      <YjIcon name="warning" size="sm" tone="error" />
      <span>{{ previewError.message }}</span>
      <button
        v-if="previewError.retryable"
        data-testid="artifact-report-retry"
        type="button"
        @click="retryPreview"
      >重试预览</button>
    </div>

    <section
      v-else-if="projection"
      ref="previewRegion"
      class="artifact-report__preview"
      data-testid="artifact-report-preview-region"
      role="region"
      :aria-labelledby="previewTitleId"
      tabindex="-1"
    >
      <header class="artifact-report__preview-header">
        <h3 :id="previewTitleId">{{ projection.title }}</h3>
        <button
          data-testid="artifact-report-close"
          type="button"
          aria-label="关闭报告预览"
          @click="closePreview"
        >
          <YjIcon name="dismiss" size="sm" />
          关闭预览
        </button>
      </header>

      <p v-if="projection.truncated" class="artifact-report__notice" role="note">
        报告仅展示部分安全投影。
      </p>

      <dl class="artifact-report__metadata" aria-label="报告时间与数据说明">
        <div><dt>生成时间</dt><dd>{{ projection.generatedAt }}</dd></div>
        <div><dt>数据时间</dt><dd>{{ projection.sourceTime ?? "报告未提供" }}</dd></div>
        <div><dt>单位</dt><dd>报告未提供</dd></div>
        <div><dt>数据来源</dt><dd>报告未提供</dd></div>
        <div><dt>时间范围</dt><dd>报告未提供</dd></div>
      </dl>

      <div class="artifact-report__sections">
        <section
          v-for="section in projection.sections"
          :key="section.ordinal"
          class="artifact-report__section"
          :data-section-ordinal="section.ordinal"
        >
          <template v-if="section.type === 'summary' || section.type === 'paragraph'">
            <h4 v-if="section.heading">{{ section.heading }}</h4>
            <p class="artifact-report__text">{{ section.text }}</p>
          </template>

          <template v-else-if="section.type === 'metrics'">
            <h4>关键指标</h4>
            <dl class="artifact-report__metrics">
              <div v-for="(item, index) in section.items" :key="index">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}<span v-if="item.unit"> {{ item.unit }}</span></dd>
              </div>
            </dl>
          </template>

          <div v-else-if="section.type === 'table'" class="artifact-report__table-region" tabindex="0" aria-label="报告数据表格，可横向滚动">
            <table>
              <caption>{{ section.caption ?? "报告数据" }}</caption>
              <thead><tr><th v-for="column in section.columns" :key="column.ordinal" scope="col">{{ column.label }}</th></tr></thead>
              <tbody>
                <tr v-for="(row, rowIndex) in section.rows" :key="rowIndex">
                  <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ scalar(cell) }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <template v-else-if="section.type === 'chart'">
            <p v-if="chartDisplay(section.ordinal)?.budgetExhausted" class="artifact-report__notice" role="note">
              已达到安全图表增强上限，本节仅展示权威表格。
            </p>
            <component
              :is="chartRenderer"
              v-if="chartDisplay(section.ordinal) && chartRenderer"
              :model="chartDisplay(section.ordinal)!.model"
            />
            <div
              v-else-if="chartDisplay(section.ordinal)"
              class="artifact-report__chart-fallback"
              data-testid="artifact-report-chart-fallback"
              :data-renderer-status="chartRendererStatus(chartDisplay(section.ordinal)!)"
            >
              <p role="status" aria-live="polite">{{ chartFallbackMessage(chartDisplay(section.ordinal)!) }}</p>
              <div class="artifact-report__table-region" tabindex="0" aria-label="图表数据表格，可横向滚动">
                <table>
                  <caption>{{ chartDisplay(section.ordinal)!.model.title }}数据</caption>
                  <thead>
                    <tr>
                      <th
                        v-for="(column, columnIndex) in chartDisplay(section.ordinal)!.model.table.columns"
                        :key="columnIndex"
                        scope="col"
                      >{{ column }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="(row, rowIndex) in chartDisplay(section.ordinal)!.model.table.rows"
                      :key="rowIndex"
                    >
                      <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>

          <div v-else-if="section.type === 'callout'" class="artifact-report__callout" :class="`artifact-report__callout--${section.tone}`" role="note">
            <YjIcon name="warning" size="sm" :tone="section.tone === 'error' ? 'error' : 'muted'" />
            <div>
              <h4 v-if="section.title">{{ section.title }}</h4>
              <p>{{ section.text }}</p>
            </div>
          </div>

          <p v-else class="artifact-report__unsupported" role="note">此可选报告区块暂不支持。</p>
          <p v-if="section.truncated" class="artifact-report__notice" role="note">本节仅展示部分内容。</p>
        </section>
      </div>
    </section>

    <p
      v-if="saveFeedback"
      class="artifact-report__save-feedback"
      :class="`artifact-report__save-feedback--${saveTone}`"
      :role="saveTone === 'error' ? 'alert' : 'status'"
      aria-live="polite"
      aria-atomic="true"
    >{{ saveFeedback }}</p>
  </section>
</template>

<style scoped>
.artifact-report {
  display: grid;
  gap: var(--yj-space-3);
  min-width: 0;
}

.artifact-report__actions,
.artifact-report__preview-header,
.artifact-report__error,
.artifact-report__callout {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
}

.artifact-report__actions { flex-wrap: wrap; }

.artifact-report button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--yj-space-2);
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.artifact-report button:hover:not(:disabled) {
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-control-hover);
}

.artifact-report button:active:not(:disabled) {
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-control-pressed);
}

.artifact-report button:focus-visible,
.artifact-report__preview:focus-visible,
.artifact-report__table-region:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: 2px;
}

.artifact-report button:disabled {
  background: var(--yj-color-control-disabled-bg); cursor: not-allowed; opacity: 0.62; }

.artifact-report__preview {
  display: grid;
  gap: var(--yj-space-4);
  min-width: 0;
  padding: var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
}

.artifact-report__preview-header {
  align-items: flex-start;
  justify-content: space-between;
}

.artifact-report__preview-header h3,
.artifact-report__section h4,
.artifact-report__callout p,
.artifact-report__text { margin: 0; }

.artifact-report__preview-header h3 {
  overflow-wrap: anywhere;
  font-size: var(--yj-font-size-card-title);
  line-height: var(--yj-line-height-card-title);
}

.artifact-report__metadata,
.artifact-report__metrics {
  display: grid;
  gap: var(--yj-space-2);
  margin: 0;
}

.artifact-report__metadata { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.artifact-report__metrics { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.artifact-report__metadata div,
.artifact-report__metrics div {
  min-width: 0;
  padding: var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-subtle);
}
.artifact-report dt { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.artifact-report dd { margin: var(--yj-space-1) 0 0; overflow-wrap: anywhere; }

.artifact-report__sections { display: grid; gap: var(--yj-space-4); }
.artifact-report__section { display: grid; min-width: 0; gap: var(--yj-space-2); }
.artifact-report__chart-fallback { display: grid; gap: var(--yj-space-2); }
.artifact-report__chart-fallback > p { margin: 0; color: var(--yj-color-text-secondary); }
.artifact-report__section + .artifact-report__section {
  padding-top: var(--yj-space-4);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.artifact-report__text { white-space: pre-wrap; overflow-wrap: anywhere; }

.artifact-report__table-region {
  max-width: 100%;
  overflow-x: auto;
  border-radius: var(--yj-radius-md);
}
.artifact-report table { width: 100%; min-width: 360px; border-collapse: collapse; }
.artifact-report caption { padding-bottom: var(--yj-space-2); text-align: left; font-weight: var(--yj-font-weight-semibold); }
.artifact-report th,
.artifact-report td {
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  text-align: left;
  white-space: nowrap;
}
.artifact-report th { background: var(--yj-color-bg-subtle); }

.artifact-report__callout {
  align-items: flex-start;
  padding: var(--yj-space-3);
  border-left: 4px solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-subtle);
}
.artifact-report__callout--success { border-left-color: var(--yj-color-success); }
.artifact-report__callout--warning { border-left-color: var(--yj-color-warning); }
.artifact-report__callout--error { border-left-color: var(--yj-color-error); }

.artifact-report__state,
.artifact-report__unavailable,
.artifact-report__unsupported,
.artifact-report__notice,
.artifact-report__save-feedback { margin: 0; color: var(--yj-color-text-secondary); }
.artifact-report__error,
.artifact-report__save-feedback--error { color: var(--yj-color-semantic-error-ink); }
.artifact-report__save-feedback--success { color: var(--yj-color-semantic-success-ink); }

@media (max-width: 700px) {
  .artifact-report__preview { padding: var(--yj-space-3); }
  .artifact-report__preview-header { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  .artifact-report,
  .artifact-report * {
    scroll-behavior: auto;
    transition: none;
    animation: none;
  }
}
</style>
