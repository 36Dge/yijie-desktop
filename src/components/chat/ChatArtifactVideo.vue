<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import {
  chatArtifactVideoNativeClient,
  ChatArtifactVideoNativeClientError,
  type ChatArtifactVideoNativeClient,
} from "../../api/chat-artifact-video-native-client";
import type {
  ArtifactVideoNativeErrorCode,
  ArtifactVideoNativeIdentity,
} from "../../domain/chat-artifact-video-native";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import YjIcon from "../yijie/YjIcon.vue";

type VideoPhase = "idle" | "opening" | "loading" | "ready" | "error";
type SafeError = Readonly<{ message: string; retryable: boolean }>;
type SaveTone = "success" | "muted" | "error";
type VideoLease = Readonly<{
  client: ChatArtifactVideoNativeClient;
  contextId: string;
  identity: ArtifactVideoNativeIdentity;
  url: string;
}>;

const props = defineProps<{
  artifact: ArtifactProjection;
  contextId: string;
  client?: ChatArtifactVideoNativeClient;
}>();

const eligible = computed(() => props.artifact.kind === "video" && props.artifact.status === "ready");
const client = computed(() => props.client ?? chatArtifactVideoNativeClient);
const identity = computed<ArtifactVideoNativeIdentity>(() => Object.freeze({
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
const displayName = computed(() => props.artifact.displayName ?? "未命名视频");
const accessibleLabel = computed(() => `播放视频：${displayName.value}`);

const phase = ref<VideoPhase>("idle");
const lease = ref<VideoLease | null>(null);
const previewError = ref<SafeError | null>(null);
const media = ref<HTMLVideoElement | null>(null);
const saving = ref(false);
const saveFeedback = ref<string | null>(null);
const saveTone = ref<SaveTone>("muted");
let identityEpoch = 0;
let openRequest = 0;
let saveRequest = 0;
let disposed = false;
let restoreFocusAfterRetry = false;

const busy = computed(() => phase.value === "opening" || phase.value === "loading");
const stateMessage = computed(() => {
  if (phase.value === "opening") return "正在准备安全视频预览…";
  if (phase.value === "loading") return "正在读取视频信息…";
  if (phase.value === "ready") return "视频可以播放。";
  return "";
});

function nativeError(error: unknown): ArtifactVideoNativeErrorCode {
  return error instanceof ChatArtifactVideoNativeClientError
    ? error.shape.code
    : "artifact_native_unavailable";
}

function safePreviewError(code: ArtifactVideoNativeErrorCode): SafeError {
  switch (code) {
    case "artifact_native_expired": return { message: "视频已过期，无法播放。", retryable: false };
    case "artifact_native_not_found": return { message: "视频内容不可用。", retryable: false };
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return { message: "当前没有权限播放这个视频。", retryable: false };
    case "artifact_native_unsupported": return { message: "当前视频格式无法播放。", retryable: false };
    case "artifact_native_integrity_failed": return { message: "视频校验失败，无法安全播放。", retryable: false };
    case "artifact_native_limit_exceeded":
    case "artifact_native_conflict": return { message: "视频预览正忙，请稍后重试。", retryable: true };
    default: return { message: "视频暂时无法播放，请重试。", retryable: true };
  }
}

function safeSaveMessage(code: ArtifactVideoNativeErrorCode): string {
  switch (code) {
    case "artifact_native_expired": return "视频已过期，无法保存。";
    case "artifact_native_not_found": return "视频内容不可用。";
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return "当前没有权限保存这个视频。";
    case "artifact_native_extension_mismatch": return "文件扩展名与视频格式不匹配。";
    case "artifact_native_dialog_unavailable": return "暂时无法打开保存窗口。";
    case "artifact_native_permission_denied": return "没有权限保存到所选位置。";
    case "artifact_native_storage_full": return "存储空间不足，视频未保存。";
    case "artifact_native_integrity_failed": return "视频校验失败，未执行保存。";
    case "artifact_native_conflict": return "另一个视频操作正在进行。";
    default: return "视频保存失败，请稍后重试。";
  }
}

function detachMedia(): void {
  const element = media.value;
  if (!element) return;
  try { element.pause(); } catch { /* WebView teardown remains fail closed. */ }
  element.removeAttribute("src");
  try { element.load(); } catch { /* WebView teardown remains fail closed. */ }
}

async function releaseLease(releasing: VideoLease | null): Promise<void> {
  if (!releasing) return;
  try {
    await releasing.client.releaseVideoPreview(releasing.contextId, releasing.identity);
  } catch {
    // Native context, expiry, and WebView cleanup independently revoke the handle.
  }
}

async function stopPlayback(releasing: VideoLease | null): Promise<void> {
  detachMedia();
  await releaseLease(releasing);
}

async function openVideo(): Promise<void> {
  if (!eligible.value || phase.value === "opening" || phase.value === "loading" || phase.value === "ready") return;
  const request = ++openRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  phase.value = "opening";
  previewError.value = null;
  try {
    const result = await issuingClient.openVideoPreview(contextId, issuingIdentity);
    const opened = Object.freeze({
      client: issuingClient,
      contextId,
      identity: issuingIdentity,
      url: result.previewUrl,
    });
    if (disposed || request !== openRequest || epoch !== identityEpoch || !eligible.value) {
      await releaseLease(opened);
      return;
    }
    lease.value = opened;
    phase.value = "loading";
  } catch (error: unknown) {
    if (disposed || request !== openRequest || epoch !== identityEpoch) return;
    lease.value = null;
    previewError.value = safePreviewError(nativeError(error));
    phase.value = "error";
  }
}

async function handleMetadataReady(): Promise<void> {
  if (!lease.value || !eligible.value) return;
  phase.value = "ready";
  if (restoreFocusAfterRetry) {
    restoreFocusAfterRetry = false;
    await nextTick();
    media.value?.focus();
  }
}

async function handleFatalError(): Promise<void> {
  if (!lease.value) return;
  const releasing = lease.value;
  lease.value = null;
  ++openRequest;
  await stopPlayback(releasing);
  if (disposed || !eligible.value) return;
  previewError.value = { message: "视频暂时无法播放，请重试。", retryable: true };
  phase.value = "error";
}

async function retryVideo(): Promise<void> {
  if (!previewError.value?.retryable || busy.value) return;
  restoreFocusAfterRetry = true;
  phase.value = "idle";
  await openVideo();
}

async function saveVideo(): Promise<void> {
  if (!eligible.value || phase.value !== "ready" || saving.value) return;
  const request = ++saveRequest;
  const epoch = identityEpoch;
  const issuingClient = client.value;
  const contextId = props.contextId;
  const issuingIdentity = identity.value;
  saving.value = true;
  saveFeedback.value = "正在打开原生保存窗口…";
  saveTone.value = "muted";
  try {
    const result = await issuingClient.saveVideo(contextId, issuingIdentity);
    if (disposed || request !== saveRequest || epoch !== identityEpoch) return;
    if (result.status === "saved") {
      saveFeedback.value = "视频已保存。";
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
  ++openRequest;
  ++saveRequest;
  const releasing = lease.value;
  lease.value = null;
  phase.value = "idle";
  previewError.value = null;
  saving.value = false;
  saveFeedback.value = null;
  restoreFocusAfterRetry = false;
  await stopPlayback(releasing);
  if (!disposed && epoch === identityEpoch && eligible.value) await openVideo();
}

watch(identityKey, () => { void replaceIdentity(); }, { immediate: true });

onBeforeUnmount(() => {
  disposed = true;
  ++identityEpoch;
  ++openRequest;
  ++saveRequest;
  const releasing = lease.value;
  lease.value = null;
  detachMedia();
  void releaseLease(releasing);
});
</script>

<template>
  <section
    v-if="eligible"
    class="artifact-video"
    aria-label="视频播放与保存"
    :aria-busy="busy ? 'true' : 'false'"
  >
    <div v-if="lease" class="artifact-video__viewport">
      <video
        ref="media"
        class="artifact-video__media"
        data-testid="artifact-video-media"
        :src="lease.url"
        :aria-label="accessibleLabel"
        controls
        controlslist="nodownload noremoteplayback"
        preload="metadata"
        playsinline
        disablepictureinpicture
        disableremoteplayback
        tabindex="0"
        @loadedmetadata="handleMetadataReady"
        @error="handleFatalError"
      />
      <span v-if="busy" class="artifact-video__overlay" role="status">{{ stateMessage }}</span>
    </div>

    <div v-else-if="busy" class="artifact-video__placeholder" role="status">
      <YjIcon name="file" size="lg" tone="muted" />
      <span>{{ stateMessage }}</span>
    </div>

    <div v-else-if="previewError" class="artifact-video__error" role="alert">
      <YjIcon name="warning" size="lg" tone="error" />
      <span>{{ previewError.message }}</span>
      <button
        v-if="previewError.retryable"
        data-testid="artifact-video-retry"
        type="button"
        @click="retryVideo"
      >重新加载</button>
    </div>

    <div class="artifact-video__footer">
      <span
        v-if="stateMessage"
        class="artifact-video__state"
        data-testid="artifact-video-state"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >{{ stateMessage }}</span>
      <button
        data-testid="artifact-video-save"
        type="button"
        :disabled="saving || phase !== 'ready'"
        aria-label="保存视频"
        title="保存视频"
        @click="saveVideo"
      >
        <YjIcon name="download" size="sm" />
        {{ saving ? "保存中" : "保存视频" }}
      </button>
    </div>

    <p
      v-if="saveFeedback"
      class="artifact-video__feedback"
      :class="`artifact-video__feedback--${saveTone}`"
      data-testid="artifact-video-feedback"
      :role="saveTone === 'error' ? 'alert' : 'status'"
      aria-live="polite"
    >{{ saveFeedback }}</p>
  </section>
</template>

<style scoped>
.artifact-video {
  display: grid;
  gap: var(--yj-space-3);
}

.artifact-video__viewport,
.artifact-video__placeholder,
.artifact-video__error {
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

.artifact-video__viewport { aspect-ratio: 16 / 9; }
.artifact-video__media {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--yj-color-bg-subtle);
  object-fit: contain;
}
.artifact-video__media:focus-visible,
.artifact-video button:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: calc(var(--yj-space-1) * -1);
}

.artifact-video__overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  color: var(--yj-color-text-primary);
  background: color-mix(in srgb, var(--yj-color-bg-card) 82%, transparent);
  font-size: var(--yj-font-size-caption);
}

.artifact-video__placeholder,
.artifact-video__error {
  flex-direction: column;
  gap: var(--yj-space-3);
  padding: var(--yj-space-6);
  text-align: center;
}
.artifact-video__error { background: var(--yj-color-error-soft); }

.artifact-video__footer {
  display: flex;
  min-height: var(--yj-space-10);
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
}
.artifact-video__state,
.artifact-video__feedback {
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}
.artifact-video__feedback { text-align: right; }
.artifact-video__feedback--success { color: var(--yj-color-success); }
.artifact-video__feedback--error { color: var(--yj-color-error); }

.artifact-video button {
  display: inline-flex;
  min-height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  font: inherit;
}
.artifact-video button:disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
  .artifact-video *,
  .artifact-video *::before,
  .artifact-video *::after {
    scroll-behavior: auto !important;
    animation: none !important;
    transition: none !important;
  }
}
</style>
