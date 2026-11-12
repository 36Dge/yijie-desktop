import { onBeforeUnmount, watch } from "vue";
import { chatClient } from "../api/chat-client";
import type { ChatDraftTarget } from "../domain/chat-ipc";
import type { AttachmentPresentationReader } from "../domain/chat-file-presentation";

// Serialize decode requests across draft and history thumbnails within the
// existing Native read budget. No paths or images are cached here or in Pinia.
let reads: Promise<unknown> = Promise.resolve();
export function useChatAttachmentPresentation(
  context: () => string | null,
  target: () => ChatDraftTarget | null,
  attachments: () => readonly string[],
  allowed: () => boolean,
  mode: "draft" | "bound" = "draft",
): AttachmentPresentationReader {
  let revision = 0;
  let ownerContext = context();
  let ownerTarget = target();
  const clear = (id: string | null, draft: ChatDraftTarget | null, attachmentId: string | null = null) => {
    if (mode === "draft" && id && draft) void chatClient.attachmentPresentation(id, draft, attachmentId, "clear").catch(() => undefined);
  };
  // Renewing a lease can replace the context/target objects without changing
  // the owner. Compare their values, not a freshly allocated tuple/reference.
  const targetKey = () => {
    const draft = target();
    return draft?.type === "session" ? `session:${draft.sessionId}` : draft?.type ?? null;
  };
  watch([context, targetKey], () => {
    revision++;
    clear(ownerContext, ownerTarget);
    ownerContext = context();
    ownerTarget = target();
  }, { flush: "sync" });
  // A busy composer invalidates pending UI reads but still owns its draft.
  // Native authorization remains authoritative for every subsequent read.
  watch(allowed, () => { revision++; }, { flush: "sync" });
  watch(() => attachments().join("\0"), (current, previous) => {
    const ids = current.split("\0");
    for (const id of previous.split("\0")) if (id && !ids.includes(id)) clear(context(), target(), id);
  });
  onBeforeUnmount(() => { revision++; clear(context(), target()); });
  return (id, signal) => {
    const owner = context();
    const current = revision;
    const draft = target();
    const valid = () => Boolean(!signal?.aborted && owner && draft && current === revision && allowed() && attachments().includes(id));
    const pending = reads.then(async () => {
      if (!valid() || !owner || !draft) throw new Error("attachment_unavailable");
      const result = await chatClient.attachmentPresentation(owner, draft, id, mode === "bound" ? "read_bound" : "read");
      if (!valid()) throw new Error("attachment_unavailable");
      return result;
    });
    reads = pending.then(() => undefined, () => undefined);
    return pending;
  };
}
