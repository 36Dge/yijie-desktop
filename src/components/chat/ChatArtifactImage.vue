<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { NModal } from "naive-ui";
import {
  chatArtifactNativeClient,
  ChatArtifactNativeClientError,
  type ChatArtifactNativeClient,
} from "../../api/chat-artifact-native-client";
import type {
  ArtifactNativeErrorCode,
  ArtifactNativeIdentity,
} from "../../domain/chat-artifact-native";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import YjIcon from "../yijie/YjIcon.vue";

type PreviewPhase = "idle" | "opening" | "loading" | "ready" | "error";
type PreviewLease = Readonly<{
  client: ChatArtifactNativeClient;
  contextId: string;
  identity: ArtifactNativeIdentity;
  url: string;
}>;
type SafeError = Readonly<{ message: string; retryable: boolean }>;
type SaveTone = "success" | "muted" | "error";

const props = defineProps<{
  artifact: ArtifactProjection;
  contextId: string;
  client?: ChatArtifactNativeClient;
}>();

const ZOOM_LEVELS = Object.freeze([1, 1.25, 1.5, 2] as const);
const eligible = computed(() => props.artifact.kind === "image" && props.artifact.status === "ready");
const client = computed(() => props.client ?? chatArtifactNativeClient);
const identity = computed<ArtifactNativeIdentity>(() => Object.freeze({
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
const altText = computed(() => ({
  synthetic: "本地合成演示图片",
  provider: "AI 生成图片",
  tool: "工具生成图片",
})[props.artifact.provenance]);
const displayName = computed(() => props.artifact.displayName ?? "未命名图片");

const inlinePhase = ref<PreviewPhase>("idle");
const inlineLease = ref<PreviewLease | null>(null);
const inlineError = ref<SafeError | null>(null);
const lightboxOpen = ref(false);
const lightboxPhase = ref<PreviewPhase>("idle");
const lightboxLease = ref<PreviewLease | null>(null);
const lightboxError = ref<SafeError | null>(null);
const zoomIndex = ref(0);
const saving = ref(false);
const saveFeedback = ref<string | null>(null);
const saveTone = ref<SaveTone>("muted");
const closeButton = ref<HTMLButtonElement | null>(null);
const dialog = ref<HTMLElement | null>(null);
let lightboxTrigger: HTMLButtonElement | null = null;
let identityEpoch = 0;
let inlineRequest = 0;
let lightboxRequest = 0;
let saveRequest = 0;
let disposed = false;

const inlineBusy = computed(() => inlinePhase.value === "opening" || inlinePhase.value === "loading");
const lightboxBusy = computed(() => lightboxPhase.value === "opening" || lightboxPhase.value === "loading");
const zoom = computed(() => ZOOM_LEVELS[zoomIndex.value]!);
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`);
const canZoomOut = computed(() => zoomIndex.value > 0);
const canZoomIn = computed(() => zoomIndex.value < ZOOM_LEVELS.length - 1);

function nativeError(error: unknown): ArtifactNativeErrorCode {
  return error instanceof ChatArtifactNativeClientError
    ? error.shape.code
    : "artifact_native_unavailable";
}

function safePreviewError(code: ArtifactNativeErrorCode): SafeError {
  switch (code) {
    case "artifact_native_expired":
      return { message: "图片已过期，无法预览。", retryable: false };
    case "artifact_native_not_found":
      return { message: "图片内容不可用。", retryable: false };
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden":
      return { message: "当前没有权限预览这张图片。", retryable: false };
    case "artifact_native_unsupported":
      return { message: "当前图片格式无法预览。", retryable: false };
    case "artifact_native_integrity_failed":
      return { message: "图片校验失败，无法安全预览。", retryable: false };
    case "artifact_native_limit_exceeded":
    case "artifact_native_conflict":
      return { message: "预览正忙，请稍后重试。", retryable: true };
    default:
      return { message: "图片暂时无法显示，请重试。", retryable: true };
  }
}

function safeSaveMessage(code: ArtifactNativeErrorCode): string {
  switch (code) {
    case "artifact_native_expired": return "图片已过期，无法保存。";
    case "artifact_native_not_found": return "图片内容不可用。";
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return "当前没有权限保存这张图片。";
    case "artifact_native_extension_mismatch": return "文件扩展名与图片格式不匹配。";
    case "artifact_native_dialog_unavailable": return "暂时无法打开保存窗口。";
    case "artifact_native_permission_denied": return "没有权限保存到所选位置。";
    case "artifact_native_storage_full": return "存储空间不足，图片未保存。";
    case "artifact_native_integrity_failed": return "图片校验失败，未执行保存。";
    case "artifact_native_conflict": return "另一个保存操作正在进行。";
    default: return "图片保存失败，请稍后重试。";
  }
}

async function releaseLease(lease: PreviewLease | null): Promise<void> {
  if (!lease) return;
  try {
    await lease.client.releaseImagePreview(lease.contextId, lease.identity);
  } catch {
    // Native context/session invalidation also revokes the handle. UI cleanup remains fail closed.
  }
}

async function openInline(): Promise<void> {
  if (!eligible.value || inlinePhase.value === "opening" || inlinePhase.value === "loading") return;
  const request = ++inlineRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  inlinePhase.value = "opening";
  inlineError.value = null;
  try {
    const result = await issuingClient.openImagePreview(contextId, issuingIdentity);
    const lease = Object.freeze({ client: issuingClient, contextId, identity: issuingIdentity, url: result.previewUrl });
    if (disposed || request !== inlineRequest || epoch !== identityEpoch || !eligible.value) {
      await releaseLease(lease);
      return;
    }
    inlineLease.value = lease;
    inlinePhase.value = "loading";
  } catch (error: unknown) {
    if (disposed || request !== inlineRequest || epoch !== identityEpoch) return;
    inlineLease.value = null;
    inlineError.value = safePreviewError(nativeError(error));
    inlinePhase.value = "error";
  }
}

function handleInlineLoad(): void {
  if (inlineLease.value) inlinePhase.value = "ready";
}

async function handleInlineError(): Promise<void> {
  const lease = inlineLease.value;
  inlineLease.value = null;
  inlinePhase.value = "opening";
  await nextTick();
  await releaseLease(lease);
  if (disposed || !eligible.value) return;
  inlineError.value = { message: "图片暂时无法显示，请重试。", retryable: true };
  inlinePhase.value = "error";
}

async function retryInline(): Promise<void> {
  if (!inlineError.value?.retryable) return;
  inlinePhase.value = "idle";
  await openInline();
}

async function openLightbox(event: MouseEvent): Promise<void> {
  if (inlinePhase.value !== "ready" || lightboxOpen.value || lightboxPhase.value === "opening") return;
  lightboxTrigger = event.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
  lightboxOpen.value = true;
  lightboxPhase.value = "opening";
  lightboxError.value = null;
  lightboxLease.value = null;
  zoomIndex.value = 0;
  const request = ++lightboxRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  await nextTick();
  closeButton.value?.focus();
  try {
    const result = await issuingClient.openImagePreview(contextId, issuingIdentity);
    const lease = Object.freeze({ client: issuingClient, contextId, identity: issuingIdentity, url: result.previewUrl });
    if (disposed || request !== lightboxRequest || epoch !== identityEpoch || !lightboxOpen.value) {
      await releaseLease(lease);
      return;
    }
    lightboxLease.value = lease;
    lightboxPhase.value = "loading";
  } catch (error: unknown) {
    if (disposed || request !== lightboxRequest || epoch !== identityEpoch || !lightboxOpen.value) return;
    lightboxError.value = safePreviewError(nativeError(error));
    lightboxPhase.value = "error";
  }
}

function handleLightboxLoad(): void {
  if (lightboxLease.value) lightboxPhase.value = "ready";
}

async function handleLightboxError(): Promise<void> {
  const lease = lightboxLease.value;
  lightboxLease.value = null;
  lightboxPhase.value = "opening";
  await nextTick();
  await releaseLease(lease);
  if (disposed || !lightboxOpen.value) return;
  lightboxError.value = { message: "图片暂时无法显示，请重试。", retryable: true };
  lightboxPhase.value = "error";
}

async function retryLightbox(): Promise<void> {
  if (!lightboxError.value?.retryable || !lightboxOpen.value) return;
  const request = ++lightboxRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  lightboxPhase.value = "opening";
  lightboxError.value = null;
  try {
    const result = await issuingClient.openImagePreview(contextId, issuingIdentity);
    const lease = Object.freeze({ client: issuingClient, contextId, identity: issuingIdentity, url: result.previewUrl });
    if (disposed || request !== lightboxRequest || epoch !== identityEpoch || !lightboxOpen.value) {
      await releaseLease(lease);
      return;
    }
    lightboxLease.value = lease;
    lightboxPhase.value = "loading";
  } catch (error: unknown) {
    if (disposed || request !== lightboxRequest || epoch !== identityEpoch || !lightboxOpen.value) return;
    lightboxError.value = safePreviewError(nativeError(error));
    lightboxPhase.value = "error";
  }
}

async function closeLightbox(): Promise<void> {
  if (!lightboxOpen.value) return;
  ++lightboxRequest;
  const lease = lightboxLease.value;
  lightboxLease.value = null;
  lightboxOpen.value = false;
  lightboxPhase.value = "idle";
  lightboxError.value = null;
  zoomIndex.value = 0;
  await nextTick();
  await releaseLease(lease);
  await nextTick();
  lightboxTrigger?.focus();
  lightboxTrigger = null;
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    void closeLightbox();
    return;
  }
  if (event.key !== "Tab" || !dialog.value) return;
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>(
    "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  )].filter((element) => !element.hasAttribute("aria-hidden"));
  if (focusable.length === 0) {
    event.preventDefault();
    dialog.value.focus();
    return;
  }
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function zoomIn(): void {
  if (canZoomIn.value) zoomIndex.value += 1;
}

function zoomOut(): void {
  if (canZoomOut.value) zoomIndex.value -= 1;
}

function resetZoom(): void {
  zoomIndex.value = 0;
}

async function saveImage(): Promise<void> {
  if (!eligible.value || saving.value) return;
  const request = ++saveRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  saving.value = true;
  saveFeedback.value = "正在打开原生保存窗口…";
  saveTone.value = "muted";
  try {
    const result = await issuingClient.saveImage(contextId, issuingIdentity);
    if (disposed || request !== saveRequest || epoch !== identityEpoch) return;
    if (result.status === "saved") {
      saveFeedback.value = "图片已保存。";
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

async function replaceIdentity(): Promise<void> {
  const epoch = ++identityEpoch;
  ++inlineRequest;
  ++lightboxRequest;
  ++saveRequest;
  const inline = inlineLease.value;
  const modal = lightboxLease.value;
  inlineLease.value = null;
  lightboxLease.value = null;
  inlinePhase.value = "idle";
  lightboxPhase.value = "idle";
  inlineError.value = null;
  lightboxError.value = null;
  lightboxOpen.value = false;
  saving.value = false;
  saveFeedback.value = null;
  zoomIndex.value = 0;
  await nextTick();
  await Promise.all([releaseLease(inline), releaseLease(modal)]);
  if (!disposed && epoch === identityEpoch && eligible.value) await openInline();
}

watch(identityKey, () => { void replaceIdentity(); }, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  ++identityEpoch;
  ++inlineRequest;
  ++lightboxRequest;
  ++saveRequest;
  const inline = inlineLease.value;
  const modal = lightboxLease.value;
  inlineLease.value = null;
  lightboxLease.value = null;
  void releaseLease(inline);
  void releaseLease(modal);
});
</script>

<template>
  <section
    v-if="eligible"
    class="artifact-image"
    aria-label="图片预览与保存"
    :aria-busy="inlineBusy ? 'true' : 'false'"
  >
    <button
      v-if="inlineLease"
      class="artifact-image__preview"
      data-testid="artifact-image-preview"
      type="button"
      :disabled="inlinePhase !== 'ready'"
      :aria-label="`预览图片：${displayName}`"
      title="预览图片"
      @click="openLightbox"
    >
      <img
        class="artifact-image__inline"
        data-testid="artifact-image-inline"
        :src="inlineLease.url"
        :alt="altText"
        @load="handleInlineLoad"
        @error="handleInlineError"
      >
      <span v-if="inlineBusy" class="artifact-image__overlay" role="status">正在安全加载图片…</span>
    </button>

    <div v-else-if="inlineBusy" class="artifact-image__placeholder" role="status">
      <YjIcon name="image" size="lg" tone="muted" />
      <span>正在准备安全预览…</span>
    </div>

    <div v-else-if="inlineError" class="artifact-image__error" role="alert">
      <YjIcon name="warning" size="lg" tone="error" />
      <span>{{ inlineError.message }}</span>
      <button
        v-if="inlineError.retryable"
        data-testid="artifact-image-retry"
        type="button"
        @click="retryInline"
      >重新加载</button>
    </div>

    <div class="artifact-image__actions">
      <button
        data-testid="artifact-image-save"
        type="button"
        :disabled="saving || inlinePhase !== 'ready'"
        aria-label="保存图片"
        title="保存图片"
        @click="saveImage"
      >
        <YjIcon name="download" size="sm" />
        {{ saving ? "保存中" : "保存图片" }}
      </button>
    </div>

    <p
      v-if="saveFeedback && !lightboxOpen"
      class="artifact-image__feedback"
      :class="`artifact-image__feedback--${saveTone}`"
      data-testid="artifact-image-feedback"
      :role="saveTone === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >{{ saveFeedback }}</p>

    <NModal
      :show="lightboxOpen"
      :mask-closable="false"
      :close-on-esc="false"
      :trap-focus="false"
      :block-scroll="true"
      :auto-focus="false"
    >
      <section
        v-if="lightboxOpen"
        ref="dialog"
        class="artifact-image__dialog"
        data-testid="artifact-image-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="`artifact-image-dialog-${artifact.artifactId}`"
        tabindex="-1"
        @keydown="handleDialogKeydown"
      >
        <header class="artifact-image__dialog-header">
          <strong :id="`artifact-image-dialog-${artifact.artifactId}`">{{ displayName }}</strong>
          <button
            ref="closeButton"
            data-testid="artifact-image-close"
            type="button"
            aria-label="关闭图片预览"
            title="关闭"
            @click="closeLightbox"
          ><YjIcon name="dismiss" size="md" /></button>
        </header>

        <div class="artifact-image__viewport" :aria-busy="lightboxBusy ? 'true' : 'false'">
          <img
            v-if="lightboxLease"
            class="artifact-image__dialog-image"
            data-testid="artifact-image-dialog-img"
            :src="lightboxLease.url"
            :alt="altText"
            :style="{ transform: `scale(${zoom})` }"
            @load="handleLightboxLoad"
            @error="handleLightboxError"
          >
          <div v-else-if="lightboxBusy" class="artifact-image__dialog-status" role="status">
            正在安全加载完整图片…
          </div>
          <div v-else-if="lightboxError" class="artifact-image__dialog-status" role="alert">
            <span>{{ lightboxError.message }}</span>
            <button v-if="lightboxError.retryable" type="button" @click="retryLightbox">重新加载</button>
          </div>
        </div>

        <footer class="artifact-image__toolbar" aria-label="图片预览工具栏">
          <button
            data-testid="artifact-image-zoom-out"
            type="button"
            :disabled="!canZoomOut"
            aria-label="缩小图片"
            title="缩小"
            @click="zoomOut"
          ><YjIcon name="zoomOut" size="sm" /></button>
          <span data-testid="artifact-image-zoom-value" aria-live="polite">{{ zoomLabel }}</span>
          <button
            data-testid="artifact-image-zoom-in"
            type="button"
            :disabled="!canZoomIn"
            aria-label="放大图片"
            title="放大"
            @click="zoomIn"
          ><YjIcon name="zoomIn" size="sm" /></button>
          <button
            data-testid="artifact-image-reset"
            type="button"
            :disabled="zoomIndex === 0"
            aria-label="重置图片缩放"
            title="重置缩放"
            @click="resetZoom"
          ><YjIcon name="refresh" size="sm" /></button>
          <button
            data-testid="artifact-image-dialog-save"
            type="button"
            :disabled="saving"
            aria-label="保存当前图片"
            title="保存图片"
            @click="saveImage"
          ><YjIcon name="download" size="sm" /></button>
          <span
            v-if="saveFeedback"
            class="artifact-image__toolbar-feedback"
            data-testid="artifact-image-dialog-feedback"
            :class="`artifact-image__feedback--${saveTone}`"
            :role="saveTone === 'error' ? 'alert' : 'status'"
            aria-live="polite"
          >{{ saveFeedback }}</span>
        </footer>
      </section>
    </NModal>
  </section>
</template>

<style scoped>
.artifact-image {
  display: grid;
  gap: var(--yj-space-3);
}

.artifact-image__preview,
.artifact-image__placeholder,
.artifact-image__error {
  position: relative;
  display: flex;
  min-height: calc(var(--yj-space-16) * 3);
  overflow: hidden;
  align-items: center;
  justify-content: center;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
}

.artifact-image__preview {
  width: 100%;
  padding: 0;
  cursor: zoom-in;
}

.artifact-image__preview:disabled { cursor: wait; }
.artifact-image__inline {
  display: block;
  width: 100%;
  max-height: calc(var(--yj-space-16) * 6);
  object-fit: contain;
}

.artifact-image__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--yj-color-text-primary);
  background: color-mix(in srgb, var(--yj-color-bg-card) 82%, transparent);
  font-size: var(--yj-font-size-caption);
}

.artifact-image__placeholder,
.artifact-image__error {
  flex-direction: column;
  gap: var(--yj-space-3);
  padding: var(--yj-space-6);
  text-align: center;
}

.artifact-image__error { background: var(--yj-color-error-soft); }
.artifact-image__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--yj-space-2);
}

.artifact-image button {
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
  font: inherit;
}

.artifact-image button:disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
}

.artifact-image button:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.artifact-image__feedback {
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  text-align: right;
}
.artifact-image__feedback--success { color: var(--yj-color-success); }
.artifact-image__feedback--error { color: var(--yj-color-error); }

.artifact-image__dialog {
  display: grid;
  width: min(calc(100vw - var(--yj-space-8)), var(--yj-layout-chat-column-max));
  max-height: calc(100vh - var(--yj-space-8));
  overflow: hidden;
  grid-template-rows: auto minmax(0, 1fr) auto;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-xl);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-popover);
}

.artifact-image__dialog-header,
.artifact-image__toolbar {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-3) var(--yj-space-4);
}
.artifact-image__dialog-header {
  justify-content: space-between;
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.artifact-image__dialog-header strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-image__viewport {
  display: grid;
  min-height: calc(var(--yj-space-16) * 5);
  overflow: auto;
  place-items: center;
  padding: var(--yj-space-4);
  background: var(--yj-color-bg-subtle);
}
.artifact-image__dialog-image {
  display: block;
  max-width: 100%;
  max-height: calc(100vh - (var(--yj-space-16) * 4));
  object-fit: contain;
  transform-origin: center;
  transition: transform var(--yj-motion-base) var(--yj-ease-standard);
}
.artifact-image__dialog-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--yj-space-3);
  color: var(--yj-color-text-secondary);
  text-align: center;
}
.artifact-image__toolbar {
  justify-content: center;
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.artifact-image__toolbar span {
  min-width: var(--yj-space-12);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  text-align: center;
}
.artifact-image__toolbar .artifact-image__toolbar-feedback {
  min-width: 100%;
  color: var(--yj-color-text-secondary);
}
.artifact-image__toolbar .artifact-image__feedback--success { color: var(--yj-color-success); }
.artifact-image__toolbar .artifact-image__feedback--error { color: var(--yj-color-error); }

@media (max-width: 640px) {
  .artifact-image__dialog {
    width: calc(100vw - var(--yj-space-4));
    max-height: calc(100vh - var(--yj-space-4));
  }
  .artifact-image__toolbar { flex-wrap: wrap; }
}

@media (prefers-reduced-motion: reduce) {
  .artifact-image__dialog-image { transition: none; }
  .artifact-image__overlay { animation: none; }
}
</style>
