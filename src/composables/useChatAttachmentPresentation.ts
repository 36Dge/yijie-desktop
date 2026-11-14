import { onBeforeUnmount, watch } from "vue";
import { chatClient } from "../api/chat-client";
import type { ChatDraftTarget } from "../domain/chat-ipc";
import type { AttachmentPresentation, AttachmentPresentationReader } from "../domain/chat-file-presentation";

// Serialize decode requests across draft and history thumbnails within the
// existing Native read budget. Bound thumbnails retain only the native short-
// lived projection in this page, never source paths or durable image data.
let reads: Promise<unknown> = Promise.resolve();
export function useChatAttachmentPresentation(
  context: () => string | null,
  target: () => ChatDraftTarget | null,
  attachments: () => readonly string[],
  allowed: () => boolean,
  mode: "draft" | "bound" = "draft",
  cacheAllowed: () => boolean = allowed,
): AttachmentPresentationReader {
  let revision = 0;
  let ownerContext = context();
  let ownerTarget = target();
  let disposed = false;
  let cacheEpoch = 0;
  const cache = new Map<string, { value: AttachmentPresentation; timer: ReturnType<typeof setTimeout> }>();
  const cacheKey = (owner: string | null, draft: ChatDraftTarget | null, id: string) => JSON.stringify([owner, draft?.type === "session" ? draft.sessionId : draft?.type, id]);
  function forget(key: string) { clearTimeout(cache.get(key)?.timer); cache.delete(key); }
  function clearCache() { cacheEpoch++; for (const key of cache.keys()) forget(key); }
  function cached(key: string) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.value.expiresAt * 1000 <= Date.now()) { forget(key); return null; }
    cache.delete(key); cache.set(key, entry);
    return entry.value;
  }
  function remember(key: string, value: AttachmentPresentation) {
    if (mode !== "bound" || !value.imageUrl || value.sourcePath !== null) return;
    const expiresAt = Math.min(value.expiresAt, Date.now() / 1000 + 30);
    if (expiresAt * 1000 <= Date.now()) return;
    forget(key);
    cache.set(key, { value: { ...value, expiresAt }, timer: setTimeout(() => forget(key), expiresAt * 1000 - Date.now()) });
    // Native projections are small thumbnails. Bound both their count and
    // estimated string bytes, even if many conversations are visited quickly.
    let bytes = [...cache.values()].reduce((sum, entry) => sum + (entry.value.imageUrl?.length ?? 0) * 2, 0);
    for (const [oldest, entry] of cache) {
      if (cache.size <= 24 && bytes <= 16 * 1024 * 1024) break;
      bytes -= (entry.value.imageUrl?.length ?? 0) * 2;
      forget(oldest);
    }
  }
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
    if (ownerContext !== context()) clearCache();
    clear(ownerContext, ownerTarget);
    ownerContext = context();
    ownerTarget = target();
  }, { flush: "sync" });
  // A busy composer invalidates pending UI reads but still owns its draft.
  // Native authorization remains authoritative for every subsequent read.
  watch(allowed, () => { revision++; }, { flush: "sync" });
  watch(cacheAllowed, value => { if (!value) { revision++; clearCache(); } }, { flush: "sync" });
  watch([targetKey, () => attachments().join("\0")], ([currentTarget, current], [previousTarget, previous]) => {
    if (currentTarget !== previousTarget) return;
    const ids = current.split("\0");
    for (const id of previous.split("\0")) if (id && !ids.includes(id)) {
      clear(context(), target(), id);
      forget(cacheKey(context(), target(), id));
    }
  });
  onBeforeUnmount(() => { disposed = true; revision++; clearCache(); clear(context(), target()); });
  const reader: AttachmentPresentationReader = (id, signal) => {
    const owner = context();
    const current = revision;
    const draft = target();
    const key = cacheKey(owner, draft, id);
    const authority = cacheEpoch;
    const valid = () => Boolean(!disposed && !signal?.aborted && owner && draft && current === revision && allowed() && cacheAllowed() && attachments().includes(id));
    const pending = reads.then(async () => {
      if (!valid() || !owner || !draft) throw new Error("attachment_unavailable");
      const retained = cached(key);
      if (retained) return retained;
      const result = await chatClient.attachmentPresentation(owner, draft, id, mode === "bound" ? "read_bound" : "read");
      // An already-issued bound read may finish after its component unmounts.
      // Keep it only for the same authority, within the original native lease.
      if (!disposed && authority === cacheEpoch && owner === context() && cacheAllowed()
        && (key !== cacheKey(context(), target(), id) || attachments().includes(id))) remember(key, result);
      if (!valid()) throw new Error("attachment_unavailable");
      return result;
    });
    reads = pending.then(() => undefined, () => undefined);
    return pending;
  };
  if (mode === "bound") {
    reader.peek = id => !disposed && context() && target() && allowed() && cacheAllowed() && attachments().includes(id)
      ? cached(cacheKey(context(), target(), id)) : null;
    reader.invalidate = id => forget(cacheKey(context(), target(), id));
  }
  return reader;
}
