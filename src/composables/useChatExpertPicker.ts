import { onScopeDispose, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { CatalogEntry } from "../domain/experts.generated";
import { useExpertsStore } from "../stores/experts.store";
import { useChatExpertsStore } from "../stores/chat-experts.store";
import { useChatComposerDraftStore } from "../stores/chat-composer-drafts.store";

/** Inline selection uses the same resource and Native binding authority as the catalog. */
export function useChatExpertPicker(sessionId: () => string | null, disabled: () => boolean) {
  const route = useRoute(), resources = useExpertsStore(), bindings = useChatExpertsStore(), drafts = useChatComposerDraftStore();
  const pending = ref(false), error = ref<string | null>(null);
  let generation = 0, disposed = false;
  watch(() => [route.fullPath, sessionId(), resources.scope, resources.contextId, bindings.contextId], () => {
    generation++; error.value = null;
  }, { flush: "sync" });
  onScopeDispose(() => { disposed = true; generation++; });

  async function select(requested: CatalogEntry): Promise<boolean> {
    if (disposed || pending.value || disabled() || !resources.contextId || !resources.snapshot?.executionAvailable) return false;
    const entry = resources.entries.find(item => item.display.expertId === requested.display.expertId && item.display.version === requested.display.version);
    if (!entry || !["ready", "available"].includes(entry.state)) return false;
    const key = `${entry.display.expertId}@${entry.display.version}`;
    if (resources.busy.has(key) || ["pending", "unknown"].includes(resources.operations[key]?.state ?? "") ||
      (entry.state === "available" && !resources.canManage)) return false;
    const session = sessionId(), original = generation;
    const current = () => !disposed && original === generation;
    const selected = session ? bindings.bindings[session]?.expert : drafts.expert("new");
    error.value = null;
    if (entry.state === "ready" && selected?.expertId === entry.display.expertId && selected.version === entry.display.version) return true;
    pending.value = true;
    try {
      if (entry.state !== "ready") {
        const prepared = await resources.execute(entry.display, "prepare");
        if (!current()) return false;
        if (!prepared) { error.value = resources.operationErrors[key] ?? "专家资源准备尚未完成，请前往管理页查看。"; return false; }
      }
      if (!current() || disabled()) return false;
      const ready = resources.entries.find(item => item.display.expertId === entry.display.expertId && item.display.version === entry.display.version);
      if (ready?.state !== "ready" || !resources.snapshot?.executionAvailable) {
        error.value = "专家资源或执行环境尚未就绪，请重新读取。"; return false;
      }
      if (session) {
        const applied = await bindings.select(session, ready.display);
        if (!current()) return false;
        if (!applied) { error.value = bindings.errors[session] ?? "专家切换尚未完成，请重新读取会话状态。"; return false; }
      } else drafts.setExpert("new", ready.display);
      return current();
    } finally { pending.value = false; }
  }
  return { pending, error, select };
}
