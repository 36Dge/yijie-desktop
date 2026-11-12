import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { chatArtifactNativeClient, ChatArtifactNativeClientError, type ChatArtifactNativeClient } from "../api/chat-artifact-native-client";
import type { ArtifactNativeErrorCode, ArtifactNativeIdentity } from "../domain/chat-artifact-native";
import type { ArtifactProjection } from "../domain/chat-artifact";
import { artifactImageStatus, artifactImageTitle } from "../domain/chat-artifact-image";

type Phase = "idle" | "opening" | "loading" | "ready" | "error";
type Lease = Readonly<{ client: ChatArtifactNativeClient; contextId: string; identity: ArtifactNativeIdentity; url: string }>;
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
  const eligible = computed(() => props.artifact.kind === "image" && props.artifact.status === "ready");
  const generating = computed(() => ["announced", "generating", "processing", "transferring"].includes(props.artifact.status));
  const title = computed(() => artifactImageTitle(props.artifact.displayName));
  const status = computed(() => artifactImageStatus(props.artifact));
  const alt = computed(() => props.artifact.provenance === "synthetic" ? `本地合成演示图片：${title.value}` : title.value);
  const inlinePhase = ref<Phase>("idle");
  const inlineLease = ref<Lease | null>(null);
  const inlineError = ref<Failure | null>(null);
  const lightboxOpen = ref(false);
  const lightboxPhase = ref<Phase>("idle");
  const lightboxLease = ref<Lease | null>(null);
  const lightboxError = ref<Failure | null>(null);
  const action = ref<"copy" | "save" | null>(null);
  let epoch = 0;
  let inlineRequest = 0;
  let lightboxRequest = 0;
  let disposed = false;
  let pendingPreview = Promise.resolve();
  // A release revokes all pending handles for this identity. Finish it before
  // requesting a replacement, including rapid close/reopen of the lightbox.
  const releases = new Set<Promise<void>>();
  const identity = (): ArtifactNativeIdentity => ({ sessionId: props.artifact.sessionId, turnId: props.artifact.turnId, artifactId: props.artifact.artifactId });
  function release(lease: Lease | null): Promise<void> {
    if (!lease) return Promise.resolve();
    const task = lease.client.releaseImagePreview(lease.contextId, lease.identity).then(() => {}, () => {});
    releases.add(task);
    void task.finally(() => releases.delete(task));
    return task;
  }
  const inlineBusy = computed(() => ["opening", "loading"].includes(inlinePhase.value));
  const lightboxBusy = computed(() => ["opening", "loading"].includes(lightboxPhase.value));

  async function openPreview(mode: "inline" | "lightbox") {
    if (!eligible.value || disposed) return;
    const modal = mode === "lightbox";
    const phase = modal ? lightboxPhase : inlinePhase;
    const leaseRef = modal ? lightboxLease : inlineLease;
    const error = modal ? lightboxError : inlineError;
    if (phase.value === "opening" || phase.value === "loading") return;
    const request = modal ? ++lightboxRequest : ++inlineRequest;
    const generation = epoch;
    const issuing = { client: props.client ?? chatArtifactNativeClient, contextId: props.contextId, identity: identity() };
    const current = () => !disposed && generation === epoch && eligible.value && request === (modal ? lightboxRequest : inlineRequest) && (!modal || lightboxOpen.value);
    const old = leaseRef.value;
    leaseRef.value = null;
    phase.value = "opening";
    error.value = null;
    // A late response from a closed viewer must be released before another
    // preview for that identity is issued; native release is identity-scoped.
    const pending = pendingPreview.then(async () => {
      await nextTick();
      await release(old);
      await Promise.all([...releases]);
      if (!current()) return;
      try {
        const result = await issuing.client.openImagePreview(issuing.contextId, issuing.identity);
        const lease = { ...issuing, url: result.previewUrl };
        if (!current()) { await release(lease); return; }
        leaseRef.value = lease;
        phase.value = "loading";
      } catch (cause) {
        if (!current()) return;
        error.value = previewFailure(errorCode(cause));
        phase.value = "error";
      }
    });
    pendingPreview = pending;
    await pending;
  }
  function loaded(mode: "inline" | "lightbox", url: string) {
    if (mode === "inline" && inlineLease.value?.url === url) inlinePhase.value = "ready";
    if (mode === "lightbox" && lightboxLease.value?.url === url) lightboxPhase.value = "ready";
  }
  async function failed(mode: "inline" | "lightbox", url: string) {
    const generation = epoch;
    const modal = mode === "lightbox";
    const request = modal ? lightboxRequest : inlineRequest;
    const lease = modal ? lightboxLease : inlineLease;
    if (lease.value?.url !== url) return;
    const phase = modal ? lightboxPhase : inlinePhase;
    const error = modal ? lightboxError : inlineError;
    const old = lease.value;
    lease.value = null;
    phase.value = "opening";
    await nextTick();
    await release(old);
    if (disposed || generation !== epoch || request !== (modal ? lightboxRequest : inlineRequest) || (modal && !lightboxOpen.value)) return;
    error.value = previewFailure("artifact_native_unavailable");
    phase.value = "error";
  }
  function openLightbox() {
    if (!eligible.value || lightboxOpen.value || inlinePhase.value !== "ready") return;
    lightboxOpen.value = true;
    lightboxPhase.value = "idle";
    void openPreview("lightbox");
  }
  function closeLightbox() {
    ++lightboxRequest;
    const lease = lightboxLease.value;
    lightboxOpen.value = false;
    lightboxLease.value = null;
    lightboxPhase.value = "idle";
    lightboxError.value = null;
    void release(lease);
  }
  async function performAction(kind: "copy" | "save") {
    if (!eligible.value || action.value) return;
    const generation = epoch;
    const issuingClient = props.client ?? chatArtifactNativeClient;
    const contextId = props.contextId;
    const boundIdentity = identity();
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
  function clear() {
    epoch++;
    inlineRequest++;
    lightboxRequest++;
    const inline = inlineLease.value;
    const modal = lightboxLease.value;
    inlineLease.value = lightboxLease.value = null;
    inlinePhase.value = lightboxPhase.value = "idle";
    inlineError.value = lightboxError.value = null;
    lightboxOpen.value = false;
    action.value = null;
    void release(inline);
    void release(modal);
  }
  watch(() => [props.contextId, props.artifact.sessionId, props.artifact.turnId, props.artifact.artifactId, props.artifact.kind, props.artifact.status, props.client], () => {
    clear();
    if (eligible.value) void openPreview("inline");
  }, { immediate: true });
  onBeforeUnmount(() => { disposed = true; clear(); });
  return { eligible, generating, title, status, alt, inlinePhase, inlineLease, inlineError, inlineBusy,
    lightboxOpen, lightboxPhase, lightboxLease, lightboxError, lightboxBusy, openLightbox, closeLightbox,
    openPreview, loaded, failed, action, performAction };
}
