import { computed, getCurrentScope, h, onScopeDispose, ref, watch } from "vue";
import { NButton, useDialog, type DialogReactive } from "naive-ui";
import { useRoute, useRouter } from "vue-router";
import { useExpertsStore } from "../stores/experts.store";
import { useChatExpertsStore } from "../stores/chat-experts.store";
import { useChatComposerDraftStore } from "../stores/chat-composer-drafts.store";
import { useChatStore } from "../stores/chat.store";
import { chatComposerDraftKey, updateChatComposerDraft } from "../domain/chat-composer-draft";
import type { CatalogEntry } from "../domain/experts.generated";

export function useExpertSummon() {
  const route = useRoute(), router = useRouter(), dialog = useDialog();
  const resources = useExpertsStore(), binding = useChatExpertsStore(), drafts = useChatComposerDraftStore(), chat = useChatStore();
  const pending = ref(false), error = ref<string | null>(null);
  let navigationGeneration = 0;
  let disposed = false;
  let confirmation: DialogReactive | null = null;
  function closeConfirmation() { const previous = confirmation; confirmation = null; previous?.destroy(); }
  function openConfirmation(options: Parameters<typeof dialog.info>[0]) {
    const forgetCurrent = () => { if (confirmation === current) confirmation = null; };
    const current = dialog.info({ ...options, onClose: forgetCurrent, onEsc: forgetCurrent, onMaskClick: forgetCurrent, onAfterLeave: forgetCurrent });
    confirmation = current;
  }
  function invalidateDestination() { navigationGeneration++; closeConfirmation(); }
  watch(() => [route.path, route.fullPath, route.query.from, resources.scope, resources.contextId, binding.contextId] as const, (next, previous) => {
    // A normal authority renewal also replaces the Native context. Keep the
    // old confirmation invalid, but explain the cancellation on this page.
    if (confirmation && next[3] && next.slice(0, 4).every((value, index) => value === previous[index]) && (next[4] !== previous[4] || next[5] !== previous[5])) {
      error.value = "授权状态已更新，本次操作未执行。请重新点击参考问题或召唤专家。";
    }
    invalidateDestination();
  }, { flush: "sync" });
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; invalidateDestination(); });
  const returnTo = computed(() => typeof route.query.from === "string" && /^\/chat(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(route.query.from) ? route.query.from : "/chat");
  const session = computed(() => returnTo.value.startsWith("/chat/") ? returnTo.value.slice(6) : null);
  const target = computed(() => chatComposerDraftKey(session.value));
  const selected = computed(() => session.value ? binding.bindings[session.value]?.expert ?? null : drafts.expert("new"));
  const busy = computed(() => pending.value || !!binding.submissions[session.value ?? "new"] || (session.value !== null && (
    binding.busy.has(session.value) || !!binding.errors[session.value] || !binding.bindings[session.value] || ["applying", "unknown", "unavailable"].includes(binding.bindings[session.value]!.state) ||
    ["queued", "pending", "running", "in_progress", "awaiting_approval", "unknown", "uncertain"].includes(chat.sessions.find(item => item.sessionId === session.value)?.latestTurnStatus ?? "")
  )));
  async function summon(entry: CatalogEntry, prompt?: string, replaceText = false, preserveText = false): Promise<void> {
    if (disposed || busy.value || !resources.snapshot?.executionAvailable || !["available", "ready"].includes(entry.state)) return;
    error.value = null;
    const destination = returnTo.value, localSession = session.value, draftTarget = target.value, scope = resources.scope;
    const originalText = drafts.texts[draftTarget] ?? "";
    const generation = navigationGeneration, context = resources.contextId, bindingContext = binding.contextId;
    const isCurrentDestination = () => !disposed && generation === navigationGeneration && scope === resources.scope && context === resources.contextId && bindingContext === binding.contextId && destination === returnTo.value;
    const confirm = (action: () => Promise<void>) => async () => {
      if (!isCurrentDestination()) return;
      closeConfirmation();
      await action();
    };
    if (prompt && !replaceText && ((drafts.texts[draftTarget] ?? "").length > 0 || chat.draftAttachments.length > 0)) {
      closeConfirmation();
      const keepDraft = confirm(() => summon(entry, undefined, false, true)), replaceDraft = confirm(() => summon(entry, prompt, true));
      openConfirmation({
        title: "保留当前草稿", content: "召唤专家后，可保留当前草稿，或用参考问题替换文字。附件会保留。",
        positiveText: "保留当前草稿", negativeText: "替换文字", onPositiveClick: keepDraft, onNegativeClick: replaceDraft,
        // Naive's default actions put negative first. Keep its focus trap and
        // render the safe primary action first so initial keyboard focus keeps.
        action: () => [
          h(NButton, { type: "primary", size: "small", onClick: keepDraft }, () => "保留当前草稿"),
          h(NButton, { size: "small", onClick: replaceDraft }, () => "替换文字"),
        ],
      });
      return;
    }
    if (selected.value && (selected.value.expertId !== entry.display.expertId || selected.value.version !== entry.display.version) && !replaceText) {
      closeConfirmation();
      openConfirmation({ title: "更换专家", content: "将从下一条消息使用新专家，已有聊天保留。", positiveText: "更换", negativeText: "取消", onPositiveClick: confirm(() => summon(entry, prompt, true, preserveText)) });
      return;
    }
    pending.value = true; error.value = null;
    try {
      if (entry.state !== "ready") {
        const prepared = await resources.execute(entry.display, "prepare");
        if (!isCurrentDestination()) return;
        if (!prepared) { error.value = "资源准备尚未完成，请查看原操作状态。"; return; }
      }
      if (!isCurrentDestination()) return;
      const ready = resources.entries.find(item => item.display.expertId === entry.display.expertId && item.display.version === entry.display.version);
      if (ready?.state !== "ready" || !resources.snapshot?.executionAvailable) { error.value = "专家资源或执行环境尚未就绪，请重新读取。"; return; }
      if (localSession) {
        const applied = await binding.select(localSession, entry.display);
        if (!isCurrentDestination()) return;
        if (!applied) { error.value = binding.errors[localSession] ?? "会话暂不能切换专家，请返回对话查看状态。"; return; }
      } else drafts.setExpert("new", ready.display);
      if (!isCurrentDestination()) return;
      if (prompt) {
        // Resource preparation and binding may finish after the user edits.
        if ((drafts.texts[draftTarget] ?? "") === originalText) drafts.texts = updateChatComposerDraft(drafts.texts, draftTarget, prompt);
      } else if (!preserveText) drafts.prefillExpertPrompt(draftTarget, ready);
      await router.push({ path: destination, query: { focus: "composer" } });
    } finally { pending.value = false; }
  }
  return { returnTo, session, selected, busy, error, summon };
}
