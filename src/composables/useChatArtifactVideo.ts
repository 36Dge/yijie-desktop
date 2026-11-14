import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch, watchEffect } from "vue";
import { drawArtifactFrame, useArtifactMediaCache, type ArtifactMediaEntry } from "./chat-artifact-media-cache";
import {
  chatArtifactVideoNativeClient,
  ChatArtifactVideoNativeClientError,
  type ChatArtifactVideoNativeClient,
} from "../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../domain/chat-artifact";
import type { ArtifactVideoNativeErrorCode } from "../domain/chat-artifact-video-native";

type Failure = Readonly<{ message: string; retryable: boolean }>;

function errorCode(error: unknown): ArtifactVideoNativeErrorCode {
  return error instanceof ChatArtifactVideoNativeClientError ? error.shape.code : "artifact_native_unavailable";
}

function previewFailure(code: ArtifactVideoNativeErrorCode): Failure {
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

function saveFailure(code: ArtifactVideoNativeErrorCode): string {
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

export function useChatArtifactVideo(
  props: Readonly<{ artifact: ArtifactProjection; contextId: string; client?: ChatArtifactVideoNativeClient }>,
  notify: (message: string, tone: "success" | "error") => void,
) {
  const cache = useArtifactMediaCache();
  const entry = shallowRef<ArtifactMediaEntry | null>(null);
  const eligible = computed(() => props.artifact.kind === "video" && props.artifact.status === "ready" && cache.canRead(props.contextId));
  const viewerOpen = ref(false);
  const cover = computed(() => entry.value?.cover.value ?? null);
  const phase = computed(() => entry.value?.phase.value ?? "idle");
  const error = computed(() => entry.value?.error.value ? previewFailure(errorCode(entry.value.error.value)) : null);
  const busy = computed(() => phase.value === "loading");
  const thumbnail = useTemplateRef<HTMLCanvasElement>("thumbnail");
  const viewerCover = useTemplateRef<HTMLCanvasElement>("viewerCover");
  const mediaHost = useTemplateRef<HTMLElement>("mediaHost");
  const saving = ref(false);
  let epoch = 0;
  let viewerRequest = 0;
  let disposed = false;

  watch([cover, thumbnail], ([source, canvas]) => {
    if (source && canvas) drawArtifactFrame(canvas, source);
  }, { flush: "post" });
  watch([cover, viewerCover], ([source, canvas]) => {
    if (source && canvas) drawArtifactFrame(canvas, source);
  }, { flush: "post" });
  watchEffect(() => {
    const video = entry.value?.video.value;
    if (!viewerOpen.value || !video || !mediaHost.value) return;
    video.controls = true;
    video.className = "artifact-video__media";
    video.dataset.testid = "artifact-video-media";
    video.setAttribute("aria-label", `播放视频：${props.artifact.displayName ?? "未命名视频"}`);
    video.tabIndex = 0;
    if (video.parentElement !== mediaHost.value) mediaHost.value.replaceChildren(video);
  }, { flush: "post" });
  watch(mediaHost, (host, previousHost) => {
    const video = entry.value?.video.value;
    if (!host && !viewerOpen.value && video?.parentElement === previousHost) video.remove();
  }, { flush: "post" });

  function closeViewer() {
    if (!viewerOpen.value) return;
    ++viewerRequest;
    viewerOpen.value = false;
    const current = entry.value;
    if (current) {
      current.viewers = Math.max(0, current.viewers - 1);
      current.video.value?.pause();
      // Keep the paused frame through the modal's leave animation. Removing
      // it here flashes the empty dialog before the mask has finished fading.
    }
  }
  async function openViewer() {
    const current = entry.value;
    if (!eligible.value || viewerOpen.value || !current || disposed) return;
    const generation = epoch;
    const request = ++viewerRequest;
    current.viewers++;
    viewerOpen.value = true;
    await cache.prepare(current);
    await nextTick();
    if (disposed || generation !== epoch || request !== viewerRequest || !viewerOpen.value || current !== entry.value) return;
    const video = current.video.value;
    if (!video || phase.value !== "ready") return;
    if (video.ended) video.currentTime = 0;
    try { await video.play(); } catch { /* Decoded cover and native controls remain available. */ }
    finally { cache.pauseInactivePlayer(current, video); }
  }
  function refresh() {
    if (!viewerOpen.value || !eligible.value || busy.value || error.value?.retryable === false || !entry.value) return;
    void cache.prepare(entry.value, true);
  }
  async function saveVideo() {
    if (!viewerOpen.value || !eligible.value || saving.value) return;
    const generation = epoch;
    saving.value = true;
    try {
      const identity = { sessionId: props.artifact.sessionId, turnId: props.artifact.turnId, artifactId: props.artifact.artifactId };
      const result = await (props.client ?? chatArtifactVideoNativeClient).saveVideo(props.contextId, identity);
      if (disposed || generation !== epoch) return;
      if (result.status === "saved") notify("视频已保存。", "success");
      else if (result.status === "failed") notify(saveFailure(result.code), "error");
    } catch (cause) {
      if (!disposed && generation === epoch) notify(saveFailure(errorCode(cause)), "error");
    } finally {
      if (!disposed && generation === epoch) saving.value = false;
    }
  }
  function unbind() {
    ++epoch;
    closeViewer();
    if (entry.value) { entry.value.video.value?.remove(); cache.relinquish(entry.value); }
    entry.value = null;
    saving.value = false;
  }
  watch([() => props.contextId, () => props.artifact.sessionId, () => props.artifact.turnId, () => props.artifact.artifactId,
    () => props.artifact.kind, () => props.artifact.status, () => props.artifact.mediaType,
    () => props.artifact.localCommittedAt, () => props.artifact.expiresAt, () => props.client, () => cache.revision.value], () => {
    if (entry.value && entry.value.contextId !== props.contextId) cache.clear();
    unbind();
    if (!eligible.value) { cache.invalidate(props.artifact, props.contextId); return; }
    const current = cache.retain(props.artifact, props.contextId, props.client ?? chatArtifactVideoNativeClient);
    entry.value = current;
    // Returning to a conversation needs only its retained cover. Acquire a
    // missing/expired player on click, not merely to display that cover again.
    if (!current.cover.value) void cache.prepare(current);
  }, { immediate: true });
  onBeforeUnmount(() => { disposed = true; unbind(); });
  return { eligible, viewerOpen, cover, phase, error, saving, busy, openViewer, closeViewer, refresh, saveVideo };
}
