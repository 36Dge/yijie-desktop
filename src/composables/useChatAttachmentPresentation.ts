import { onBeforeUnmount, watch } from "vue";
import { chatClient } from "../api/chat-client";
import type { ChatDraftTarget } from "../domain/chat-ipc";
import type { AttachmentPresentationReader } from "../domain/chat-file-presentation";

// Paths and projected images are never stored here or in Pinia. The calling
// chip owns its bounded result only while its popover is visible.
export function useChatAttachmentPresentation(
  context: () => string | null,
  target: () => ChatDraftTarget | null,
  attachments: () => readonly string[],
  allowed: () => boolean,
): AttachmentPresentationReader {
  let revision = 0;
  const clear = (id: string | null, draft: ChatDraftTarget | null, attachmentId: string | null = null) => {
    if (id && draft) void chatClient.attachmentPresentation(id, draft, attachmentId, "clear").catch(() => undefined);
  };
  watch(() => [context(), target(), allowed()] as const, (_, previous) => {
    revision++;
    clear(previous?.[0] ?? null, previous?.[1] ?? target());
  });
  watch(attachments, (current, previous) => {
    revision++;
    for (const id of previous) if (!current.includes(id)) clear(context(), target(), id);
  });
  onBeforeUnmount(() => { revision++; clear(context(), target()); });
  return async id => {
    const owner = context();
    const current = revision;
    const draft = target();
    if (!owner || !draft || !allowed() || !attachments().includes(id)) throw new Error("attachment_unavailable");
    const result = await chatClient.attachmentPresentation(owner, draft, id, "read");
    if (current !== revision || !allowed() || !attachments().includes(id)) throw new Error("attachment_unavailable");
    return result;
  };
}
