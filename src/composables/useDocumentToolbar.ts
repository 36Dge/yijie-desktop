import { computed, onBeforeUnmount, ref, watch } from "vue";
import { chatArtifactFileNativeClient } from "../api/chat-artifact-file-native-client";
import { chatArtifactReportNativeClient } from "../api/chat-artifact-report-native-client";
import { documentPreviewClient } from "../api/chat-document-preview-client";
import type { PreviewFile } from "../domain/conversation-file-preview";

export function useDocumentToolbar(input: {
  file: () => PreviewFile | null;
  context: () => string | null;
  enabled: () => boolean;
  revision: () => string | null;
  saveSupported: () => boolean;
  locationSupported: () => boolean;
}) {
  const pathOpen = ref(false);
  const path = ref<string | null>(null);
  const pathState = ref<"idle" | "loading" | "ready" | "error">("idle");
  const saving = ref(false);
  const identity = computed(() => JSON.stringify([input.context(), input.file()?.source, input.enabled()]));
  let epoch = 0;
  let pathRequest = 0;
  let disposed = false;
  const canLocate = computed(() => Boolean(input.file() && input.context() && input.enabled() &&
    (input.file()?.source.kind === "messageFile" || (input.locationSupported() && input.revision()))));
  const canSave = computed(() => {
    const file = input.file();
    return Boolean(file && input.context() && input.enabled() && !saving.value &&
      ["ready", "bound"].includes(file.status) &&
      (file.source.kind === "artifact" || (input.saveSupported() && input.revision())));
  });
  function reset() {
    epoch++;
    pathRequest++;
    pathOpen.value = false;
    path.value = null;
    pathState.value = "idle";
    saving.value = false;
  }
  watch(identity, reset, { flush: "sync" });
  watch(canLocate, available => {
    if (!available) {
      pathRequest++;
      pathOpen.value = false;
      path.value = null;
      pathState.value = "idle";
    }
  }, { flush: "sync" });
  watch(input.revision, () => {
    pathRequest++;
    path.value = null;
    pathState.value = "idle";
    if (pathOpen.value) void locate();
  });
  async function locate() {
    const file = input.file();
    const context = input.context();
    if (!file || !context || !canLocate.value || pathState.value === "loading" || pathState.value === "ready") return;
    const generation = epoch;
    const request = ++pathRequest;
    pathState.value = "loading";
    try {
      const source = file.source;
      const viewId = crypto.randomUUID();
      const result = source.kind === "messageFile"
        ? await documentPreviewClient.run(context, { action: "locate", viewId, source })
        : await documentPreviewClient.run(context, { action: "locate", viewId, source, revision: input.revision()! });
      if (disposed || generation !== epoch || request !== pathRequest || !canLocate.value) return;
      path.value = result.path ?? null;
      pathState.value = result.path ? "ready" : "error";
    } catch {
      if (!disposed && generation === epoch && request === pathRequest && canLocate.value) pathState.value = "error";
    }
  }
  watch(pathOpen, open => { if (open) void locate(); });
  async function save() {
    const file = input.file();
    const context = input.context();
    if (!canSave.value || !file || !context) return;
    const generation = epoch;
    const revision = input.revision();
    saving.value = true;
    try {
      const source = file.source;
      if (source.kind === "artifact") {
        const identity = { sessionId: source.sessionId, turnId: source.turnId, artifactId: source.artifactId };
        if (file.artifact?.kind === "report" || file.mediaType === "application/vnd.yijie.report+json;version=1") await chatArtifactReportNativeClient.saveReport(context, identity);
        else await chatArtifactFileNativeClient.saveFile(context, identity);
      } else if (revision) {
        await documentPreviewClient.run(context, { action: "save", viewId: crypto.randomUUID(), source, revision });
      }
    } catch { /* Saving has no status text in the document UI, per the user's preference. */ }
    finally { if (!disposed && generation === epoch) saving.value = false; }
  }
  onBeforeUnmount(() => { disposed = true; reset(); });
  return { pathOpen, path, pathState, canLocate, saving, canSave, save };
}
