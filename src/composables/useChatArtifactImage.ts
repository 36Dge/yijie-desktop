import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useArtifactMediaCache, type ArtifactMediaEntry } from "./chat-artifact-media-cache";
import { chatArtifactNativeClient, ChatArtifactNativeClientError, type ChatArtifactNativeClient } from "../api/chat-artifact-native-client";
import type { ArtifactNativeErrorCode } from "../domain/chat-artifact-native";
import type { ArtifactProjection } from "../domain/chat-artifact";
import { artifactImageStatus, artifactImageTitle } from "../domain/chat-artifact-image";

type Failure = Readonly<{ message: string; retryable: boolean }>;

function errorCode(error: unknown): ArtifactNativeErrorCode {
  return error instanceof ChatArtifactNativeClientError ? error.shape.code : "artifact_native_unavailable";
}
function previewFailure(code: ArtifactNativeErrorCode): Failure {
  switch (code) {
    case "artifact_native_expired": return { message: "图片已过期，无法预览。", retryable: false };
    case "artifact_native_not_found": return { message: "图片内容不可用。", retryable: false };
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return { message: "当前没有权限预览这张图片。", retryable: false };
    case "artifact_native_unsupported": return { message: "当前图片格式无法预览。", retryable: false };
    case "artifact_native_integrity_failed": return { message: "图片校验失败，无法预览。", retryable: false };
    default: return { message: "图片暂时无法显示，请重试。", retryable: true };
  }
}
function actionFailure(code: ArtifactNativeErrorCode, action: "复制" | "下载"): string {
  switch (code) {
    case "artifact_native_expired": return `图片已过期，无法${action}。`;
    case "artifact_native_not_found": return "图片内容不可用。";
    case "artifact_native_unauthenticated":
    case "artifact_native_forbidden": return `当前没有权限${action}这张图片。`;
    case "artifact_native_unsupported": return `当前图片格式无法${action}。`;
    case "artifact_native_extension_mismatch": return "文件扩展名与图片格式不匹配。";
    case "artifact_native_dialog_unavailable": return "暂时无法打开保存窗口。";
    case "artifact_native_permission_denied": return "没有权限保存到所选位置。";
    case "artifact_native_storage_full": return "存储空间不足，图片未保存。";
    case "artifact_native_integrity_failed": return `图片校验失败，未执行${action}。`;
    case "artifact_native_conflict": return "另一个图片操作正在进行，请稍后重试。";
    default: return `图片${action}失败，请重试。`;
  }
}

export function useChatArtifactImage(
  props: Readonly<{ artifact: ArtifactProjection; contextId: string; client?: ChatArtifactNativeClient }>,
  notify: (message: string, tone: "success" | "error") => void,
) {
  const cache = useArtifactMediaCache();
  const entry = shallowRef<ArtifactMediaEntry | null>(null);
  const eligible = computed(() => props.artifact.kind === "image" && props.artifact.status === "ready" && cache.canRead(props.contextId));
  const generating = computed(() => ["announced", "generating", "processing", "transferring"].includes(props.artifact.status));
  const title = computed(() => artifactImageTitle(props.artifact.displayName));
  const status = computed(() => artifactImageStatus(props.artifact));
  const alt = computed(() => props.artifact.provenance === "synthetic" ? `本地合成演示图片：${title.value}` : title.value);
  const source = computed(() => entry.value?.image.value ?? null);
  const phase = computed(() => entry.value?.phase.value ?? "idle");
  const decoded = computed(() => { void phase.value; return Boolean(source.value && entry.value && entry.value.decodedBytes > 0); });
  const inlinePhase = computed(() => decoded.value ? "ready" : phase.value);
  const inlineBusy = computed(() => !decoded.value && phase.value === "loading");
  const failure = computed(() => entry.value?.error.value ? previewFailure(errorCode(entry.value.error.value)) : null);
  const inlineError = computed(() => decoded.value ? null : failure.value);
  const lightboxOpen = ref(false);
  const lightboxPhase = phase;
  const lightboxBusy = computed(() => phase.value === "loading");
  const lightboxError = failure;
  const action = ref<"copy" | "save" | null>(null);
  let epoch = 0;
  let disposed = false;

  function openPreview(mode: "inline" | "lightbox") {
    if (mode === "lightbox" && !lightboxOpen.value) return;
    if (!entry.value || !eligible.value || lightboxBusy.value || failure.value?.retryable === false) return;
    return cache.prepare(entry.value, true);
  }
  function openLightbox() {
    if (!eligible.value || lightboxOpen.value || !decoded.value) return;
    lightboxOpen.value = true;
  }
  function closeLightbox() {
    lightboxOpen.value = false;
  }
  async function performAction(kind: "copy" | "save") {
    if (!eligible.value || action.value) return;
    const generation = epoch;
    const issuingClient = props.client ?? chatArtifactNativeClient;
    const contextId = props.contextId;
    const boundIdentity = { sessionId: props.artifact.sessionId, turnId: props.artifact.turnId, artifactId: props.artifact.artifactId };
    action.value = kind;
    try {
      if (kind === "copy") {
        await issuingClient.copyImage(contextId, boundIdentity);
        if (!disposed && generation === epoch) notify("已复制", "success");
      } else {
        const result = await issuingClient.saveImage(contextId, boundIdentity);
        if (disposed || generation !== epoch) return;
        if (result.status === "saved") notify("图片已保存", "success");
        else if (result.status === "failed") notify(actionFailure(result.code, "下载"), "error");
      }
    } catch (cause) {
      if (!disposed && generation === epoch) notify(actionFailure(errorCode(cause), kind === "copy" ? "复制" : "下载"), "error");
    } finally {
      if (!disposed && generation === epoch) action.value = null;
    }
  }
  function unbind() {
    ++epoch;
    closeLightbox();
    source.value?.remove();
    if (entry.value) cache.relinquish(entry.value);
    entry.value = null;
    action.value = null;
  }
  watch([() => props.contextId, () => props.artifact.sessionId, () => props.artifact.turnId, () => props.artifact.artifactId,
    () => props.artifact.kind, () => props.artifact.status, () => props.artifact.mediaType,
    () => props.artifact.localCommittedAt, () => props.artifact.expiresAt, () => props.client, () => cache.revision.value], () => {
    if (entry.value && entry.value.contextId !== props.contextId) cache.clear();
    unbind();
    if (!eligible.value) { cache.invalidate(props.artifact, props.contextId); return; }
    const current = cache.retain(props.artifact, props.contextId, props.client ?? chatArtifactNativeClient);
    entry.value = current;
    void cache.prepare(current);
  }, { immediate: true });
  onBeforeUnmount(() => { disposed = true; unbind(); });
  return { eligible, generating, title, status, alt, source, inlinePhase, inlineError, inlineBusy,
    lightboxOpen, lightboxPhase, lightboxError, lightboxBusy, openLightbox, closeLightbox,
    openPreview, action, performAction };
}
