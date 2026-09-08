<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  chatArtifactFileNativeClient,
  ChatArtifactFileNativeClientError,
  type ChatArtifactFileNativeClient,
} from "../../api/chat-artifact-file-native-client";
import type {
  ArtifactFileNativeErrorCode,
  ArtifactFileNativeIdentity,
  ArtifactFilePreviewResult,
} from "../../domain/chat-artifact-file-native";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import YjIcon from "../yijie/YjIcon.vue";

type PreviewPhase = "idle" | "loading" | "previewed" | "error";
type SafeError = Readonly<{ message: string; retryable: boolean }>;
type SaveTone = "success" | "muted" | "error";
type SearchSegment = Readonly<{ text: string; hit: boolean }>;
type SearchView = Readonly<{
  text: readonly SearchSegment[] | null;
  rows: readonly (readonly (readonly SearchSegment[])[])[];
  hits: number;
}>;

const props = defineProps<{
  artifact: ArtifactProjection;
  contextId: string;
  client?: ChatArtifactFileNativeClient;
}>();

const INLINE_MEDIA_TYPES = new Set(["text/plain", "text/csv", "application/json"]);
const SAVE_MEDIA_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
const MAX_SEARCH_SCALARS = 128;
const MAX_SEARCH_HITS = 100;

const eligible = computed(() => props.artifact.kind === "file" && props.artifact.status === "ready");
const client = computed(() => props.client ?? chatArtifactFileNativeClient);
const identity = computed<ArtifactFileNativeIdentity>(() => Object.freeze({
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
const displayName = computed(() => props.artifact.displayName ?? "未命名文件");
const canPreview = computed(() => eligible.value && props.artifact.mediaType !== null &&
  INLINE_MEDIA_TYPES.has(props.artifact.mediaType));
const canSave = computed(() => eligible.value && props.artifact.mediaType !== null &&
  SAVE_MEDIA_TYPES.has(props.artifact.mediaType));
const saveOnly = computed(() => eligible.value && canSave.value && !canPreview.value);
const previewTitleId = computed(() => `artifact-file-${props.artifact.artifactId}-preview-title`);

const phase = ref<PreviewPhase>("idle");
const projection = ref<ArtifactFilePreviewResult | null>(null);
const previewError = ref<SafeError | null>(null);
const previewTrigger = ref<HTMLButtonElement | null>(null);
const previewRegion = ref<HTMLElement | null>(null);
const searchQuery = ref("");
const saving = ref(false);
const saveFeedback = ref<string | null>(null);
const saveTone = ref<SaveTone>("muted");
let identityEpoch = 0;
let previewRequest = 0;
let saveRequest = 0;
let disposed = false;

const busy = computed(() => phase.value === "loading");
const textProjection = computed(() => projection.value?.mediaType === "text/plain" ||
  projection.value?.mediaType === "application/json" ? projection.value : null);
const csvProjection = computed(() => projection.value?.mediaType === "text/csv" ? projection.value : null);

function nativeError(error: unknown): ArtifactFileNativeErrorCode {
  return error instanceof ChatArtifactFileNativeClientError
    ? error.shape.code
    : "artifact_native_unavailable";
}

function safePreviewError(code: ArtifactFileNativeErrorCode): SafeError {
  switch (code) {
    case "artifact_native_expired": return { message: "文件已过期，无法预览。", retryable: false };
    case "artifact_native_not_found": return { message: "文件内容不可用。", retryable: false };
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return { message: "当前没有权限预览这个文件。", retryable: false };
    case "artifact_native_not_ready": return { message: "文件尚未就绪，无法预览。", retryable: false };
    case "artifact_native_unsupported": return { message: "当前文件格式不支持应用内预览，可使用原生保存。", retryable: false };
    case "artifact_native_integrity_failed": return { message: "文件校验失败，无法安全预览。", retryable: false };
    case "artifact_native_limit_exceeded": return { message: "文件超出安全预览范围，可使用原生保存。", retryable: false };
    case "artifact_native_conflict": return { message: "文件预览正忙，请稍后重试。", retryable: true };
    default: return { message: "文件暂时无法预览，请重试。", retryable: true };
  }
}

function safeSaveMessage(code: ArtifactFileNativeErrorCode): string {
  switch (code) {
    case "artifact_native_expired": return "文件已过期，无法保存。";
    case "artifact_native_not_found": return "文件内容不可用。";
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return "当前没有权限保存这个文件。";
    case "artifact_native_extension_mismatch": return "文件扩展名与内容格式不匹配。";
    case "artifact_native_dialog_unavailable": return "暂时无法打开保存窗口。";
    case "artifact_native_permission_denied": return "没有权限保存到所选位置。";
    case "artifact_native_storage_full": return "存储空间不足，文件未保存。";
    case "artifact_native_integrity_failed": return "文件校验失败，未执行保存。";
    case "artifact_native_conflict": return "另一个文件操作正在进行。";
    default: return "文件保存失败，请稍后重试。";
  }
}

function highlighted(value: string, query: string, budget: { remaining: number }): readonly SearchSegment[] {
  if (query.length === 0 || budget.remaining === 0) return [{ text: value, hit: false }];
  const segments: SearchSegment[] = [];
  let cursor = 0;
  while (budget.remaining > 0) {
    const match = value.indexOf(query, cursor);
    if (match < 0) break;
    if (match > cursor) segments.push({ text: value.slice(cursor, match), hit: false });
    segments.push({ text: query, hit: true });
    budget.remaining -= 1;
    cursor = match + query.length;
  }
  if (cursor < value.length) segments.push({ text: value.slice(cursor), hit: false });
  return segments.length > 0 ? segments : [{ text: value, hit: false }];
}

const searchView = computed<SearchView>(() => {
  const value = projection.value;
  const query = searchQuery.value;
  const budget = { remaining: MAX_SEARCH_HITS };
  if (!value || query.length === 0) {
    return { text: null, rows: [], hits: 0 };
  }
  if (value.mediaType === "text/csv") {
    const rows = value.rows.map((row) => row.map((cell) => highlighted(cell, query, budget)));
    return { text: null, rows, hits: MAX_SEARCH_HITS - budget.remaining };
  }
  return {
    text: highlighted(value.text, query, budget),
    rows: [],
    hits: MAX_SEARCH_HITS - budget.remaining,
  };
});

function plainSegments(value: string): readonly SearchSegment[] {
  return searchQuery.value.length > 0
    ? (searchView.value.text ?? [{ text: value, hit: false }])
    : [{ text: value, hit: false }];
}

function csvCellSegments(rowIndex: number, cellIndex: number, value: string): readonly SearchSegment[] {
  return searchQuery.value.length > 0
    ? (searchView.value.rows[rowIndex]?.[cellIndex] ?? [{ text: value, hit: false }])
    : [{ text: value, hit: false }];
}

function clearAuthorizedContent(): void {
  projection.value = null;
  searchQuery.value = "";
}

async function openPreview(): Promise<void> {
  if (!canPreview.value || phase.value === "loading" || phase.value === "previewed") return;
  const request = ++previewRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  clearAuthorizedContent();
  previewError.value = null;
  phase.value = "loading";
  try {
    const result = await issuingClient.readFilePreview(contextId, issuingIdentity);
    if (disposed || request !== previewRequest || epoch !== identityEpoch || !canPreview.value) return;
    projection.value = result;
    phase.value = "previewed";
    await nextTick();
    previewRegion.value?.focus();
  } catch (error: unknown) {
    if (disposed || request !== previewRequest || epoch !== identityEpoch) return;
    clearAuthorizedContent();
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
  ++previewRequest;
  clearAuthorizedContent();
  previewError.value = null;
  phase.value = "idle";
  await nextTick();
  previewTrigger.value?.focus();
}

function updateSearch(event: Event): void {
  const input = event.currentTarget;
  if (!(input instanceof HTMLInputElement)) return;
  const bounded = Array.from(input.value).slice(0, MAX_SEARCH_SCALARS).join("");
  if (input.value !== bounded) input.value = bounded;
  searchQuery.value = bounded;
}

async function saveFile(): Promise<void> {
  if (!canSave.value || saving.value) return;
  const request = ++saveRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  saving.value = true;
  saveFeedback.value = "正在打开原生保存窗口…";
  saveTone.value = "muted";
  try {
    const result = await issuingClient.saveFile(contextId, issuingIdentity);
    if (disposed || request !== saveRequest || epoch !== identityEpoch) return;
    if (result.status === "saved") {
      saveFeedback.value = "文件已保存。";
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
    if (!disposed && request === saveRequest && epoch === identityEpoch) saving.value = false;
  }
}

function replaceIdentity(): void {
  ++identityEpoch;
  ++previewRequest;
  ++saveRequest;
  clearAuthorizedContent();
  previewError.value = null;
  phase.value = "idle";
  saving.value = false;
  saveFeedback.value = null;
  saveTone.value = "muted";
}

watch(identityKey, replaceIdentity);

onBeforeUnmount(() => {
  disposed = true;
  ++identityEpoch;
  ++previewRequest;
  ++saveRequest;
  clearAuthorizedContent();
});
</script>

<template>
  <section
    v-if="eligible"
    class="artifact-file"
    data-testid="artifact-file"
    aria-label="文件预览与保存"
    :aria-busy="busy ? 'true' : 'false'"
  >
    <div class="artifact-file__actions">
      <button class="yj-control"
        v-if="canPreview"
        ref="previewTrigger"
        data-testid="artifact-file-open"
        type="button"
        :disabled="busy || phase === 'previewed'"
        :aria-expanded="phase === 'previewed' ? 'true' : 'false'"
        @click="openPreview"
      >
        <YjIcon name="file" size="sm" />
        {{ busy ? "预览中" : "预览文件" }}
      </button>
      <span v-else-if="saveOnly" class="artifact-file__fallback" role="note">
        当前格式不支持应用内预览，可使用原生保存。
      </span>
      <span v-else class="artifact-file__fallback" role="note">当前文件格式不可用。</span>

      <button class="yj-control"
        v-if="canSave"
        data-testid="artifact-file-save"
        type="button"
        :disabled="saving"
        aria-label="保存文件"
        title="保存文件"
        @click="saveFile"
      >
        <YjIcon name="download" size="sm" />
        {{ saving ? "保存中" : "保存文件" }}
      </button>
    </div>

    <p
      v-if="busy"
      class="artifact-file__state"
      data-testid="artifact-file-state"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >正在读取安全文件预览…</p>

    <div v-else-if="previewError" class="artifact-file__error" role="alert">
      <YjIcon name="warning" size="sm" tone="error" />
      <span>{{ previewError.message }}</span>
      <button class="yj-control"
        v-if="previewError.retryable"
        data-testid="artifact-file-retry"
        type="button"
        @click="retryPreview"
      >重试预览</button>
    </div>

    <section
      v-else-if="projection"
      ref="previewRegion"
      class="artifact-file__preview"
      data-testid="artifact-file-preview-region"
      role="region"
      :aria-labelledby="previewTitleId"
      tabindex="-1"
    >
      <header class="artifact-file__preview-header">
        <h3 :id="previewTitleId">{{ displayName }} 预览</h3>
        <button class="yj-control"
          data-testid="artifact-file-close"
          type="button"
          aria-label="关闭文件预览"
          title="关闭文件预览"
          @click="closePreview"
        >
          <YjIcon name="dismiss" size="sm" />
          关闭预览
        </button>
      </header>

      <p
        v-if="projection.truncated"
        class="artifact-file__notice"
        data-testid="artifact-file-truncated"
        role="status"
      >仅预览部分内容，截断区未搜索</p>

      <div class="artifact-file__search">
        <label :for="`artifact-file-${artifact.artifactId}-search`">在当前预览中搜索</label>
        <input
          :id="`artifact-file-${artifact.artifactId}-search`"
          data-testid="artifact-file-search"
          type="search"
          :value="searchQuery"
          autocomplete="off"
          spellcheck="false"
          @input="updateSearch"
        >
        <span
          data-testid="artifact-file-search-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >{{ searchQuery ? `找到 ${searchView.hits} 处匹配，最多显示 100 处` : "输入区分大小写的精确文本" }}</span>
      </div>

      <pre
        v-if="textProjection"
        class="artifact-file__text"
        tabindex="0"
      ><template v-for="(segment, index) in plainSegments(textProjection.text)" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template></pre>

      <div v-else-if="csvProjection" class="artifact-file__table-scroll" tabindex="0">
        <table :aria-label="`${displayName} 文件内容`">
          <thead v-if="csvProjection.rows.length > 0">
            <tr>
              <th v-for="(cell, cellIndex) in csvProjection.rows[0]" :key="cellIndex" scope="col">
                <template v-for="(segment, segmentIndex) in csvCellSegments(0, cellIndex, cell)" :key="segmentIndex"><mark v-if="segment.hit">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in csvProjection.rows.slice(1)" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex">
                <template v-for="(segment, segmentIndex) in csvCellSegments(rowIndex + 1, cellIndex, cell)" :key="segmentIndex"><mark v-if="segment.hit">{{ segment.text }}</mark><span v-else>{{ segment.text }}</span></template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p
      v-if="saveFeedback"
      class="artifact-file__feedback"
      :class="`artifact-file__feedback--${saveTone}`"
      data-testid="artifact-file-feedback"
      :role="saveTone === 'error' ? 'alert' : 'status'"
      aria-live="polite"
      aria-atomic="true"
    >{{ saveFeedback }}</p>
  </section>
</template>

<style scoped>
.artifact-file {
  display: grid;
  gap: var(--yj-space-3);
}

.artifact-file__actions,
.artifact-file__preview-header,
.artifact-file__error {
  display: flex;
  align-items: center;
  gap: var(--yj-space-3);
}

.artifact-file__actions,
.artifact-file__preview-header {
  justify-content: space-between;
}

.artifact-file button {
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.artifact-file button:hover:not(:disabled) {
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-control-hover);
}

.artifact-file button:active:not(:disabled) {
  border-color: var(--yj-color-border-control-hover);
  background: var(--yj-color-control-pressed);
}

.artifact-file button:disabled {
  background: var(--yj-color-control-disabled-bg);
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
}

.artifact-file button:focus-visible,
.artifact-file input:focus-visible,
.artifact-file__preview:focus-visible,
.artifact-file__text:focus-visible,
.artifact-file__table-scroll:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.artifact-file__fallback,
.artifact-file__state,
.artifact-file__feedback,
.artifact-file__search span {
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.artifact-file__error {
  padding: var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-semantic-error-ink);
  background: var(--yj-color-error-soft);
}

.artifact-file__preview {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-3);
  padding: var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
}

.artifact-file__preview h3 {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: var(--yj-font-size-body);
}

.artifact-file__notice {
  margin: 0;
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-semantic-warning-ink);
  background: var(--yj-color-warning-soft);
  font-size: var(--yj-font-size-caption);
}

.artifact-file__search {
  display: grid;
  grid-template-columns: minmax(8rem, auto) minmax(10rem, 1fr);
  align-items: center;
  gap: var(--yj-space-2) var(--yj-space-3);
}

.artifact-file__search label {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.artifact-file__search input {
  min-height: var(--yj-space-10);
  min-width: 0;
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-control);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  font: inherit;
}

.artifact-file__search span {
  grid-column: 2;
}

.artifact-file__text,
.artifact-file__table-scroll {
  max-height: calc(var(--yj-space-16) * 8);
  overflow: auto;
  margin: 0;
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-subtle);
}

.artifact-file__text {
  padding: var(--yj-space-3);
  color: var(--yj-color-text-primary);
  font-family: var(--yj-font-family-sans);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.artifact-file table {
  width: 100%;
  border-collapse: collapse;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-caption);
}

.artifact-file th,
.artifact-file td {
  max-width: calc(var(--yj-space-16) * 5);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  overflow-wrap: anywhere;
  text-align: left;
  vertical-align: top;
}

.artifact-file th {
  background: var(--yj-color-bg-elevated);
  font-weight: var(--yj-font-weight-semibold);
}

.artifact-file mark {
  color: inherit;
  background: var(--yj-color-warning-soft);
}

.artifact-file__feedback { text-align: right; }
.artifact-file__feedback--success { color: var(--yj-color-semantic-success-ink); }
.artifact-file__feedback--error { color: var(--yj-color-semantic-error-ink); }

@media (max-width: 720px) {
  .artifact-file__actions,
  .artifact-file__preview-header {
    align-items: stretch;
    flex-direction: column;
  }

  .artifact-file__search {
    grid-template-columns: 1fr;
  }

  .artifact-file__search span { grid-column: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .artifact-file *,
  .artifact-file *::before,
  .artifact-file *::after {
    scroll-behavior: auto !important;
    animation: none !important;
    transition: none !important;
  }
}
</style>
