import { ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { ProfileId } from "../api/chat-model-client";
import { createChatComposerDrafts, clearChatComposerDraft, updateChatComposerDraft, type ChatComposerDraftKey } from "../domain/chat-composer-draft";
import type { SelectionDisplay } from "../domain/market-connectors.generated";
import { usePermissionStore } from "./permission.store";

/** In-memory drafts survive page navigation, never account logout or scope changes. */
export const useChatComposerDraftStore = defineStore("chat-composer-drafts", () => {
  const permission = usePermissionStore();
  const texts = shallowRef(createChatComposerDrafts());
  const selections = shallowRef<Readonly<Partial<Record<ChatComposerDraftKey, readonly SelectionDisplay[]>>>>({});
  const workspaceId = ref<string | null>(null);
  const newProfile = ref<ProfileId>("kimi-k3-max-v1");
  const planProfile = ref<ProfileId>("kimi-k3-max-v1");
  let tenant: string | null = null;

  function clear(): void {
    texts.value = createChatComposerDrafts(); selections.value = {}; workspaceId.value = null;
    newProfile.value = "kimi-k3-max-v1"; planProfile.value = "kimi-k3-max-v1";
  }
  function selection(target: ChatComposerDraftKey): readonly SelectionDisplay[] { return selections.value[target] ?? []; }
  function setSelection(target: ChatComposerDraftKey, values: readonly SelectionDisplay[]): void {
    selections.value = { ...selections.value, [target]: Object.freeze(values.map(value => Object.freeze({ ...value, reference: Object.freeze({ ...value.reference }) }))) };
  }
  function clearSelection(target: ChatComposerDraftKey): void { const next = { ...selections.value }; delete next[target]; selections.value = next; }
  function clearTarget(target: ChatComposerDraftKey): void { texts.value = clearChatComposerDraft(texts.value, target); clearSelection(target); }
  function preparePlanDraft(): void {
    const source = texts.value.new ?? "";
    if (!(texts.value["plan:new"] ?? "").length && source.length) texts.value = updateChatComposerDraft(texts.value, "plan:new", source);
  }

  watch(() => [permission.selectedTenantId, permission.phase, permission.capabilities.join("|")] as const, ([nextTenant, phase]) => {
    if (tenant !== null && nextTenant !== null && tenant !== nextTenant) clear();
    if (nextTenant !== null) tenant = nextTenant;
    // A management-context rebind changes chat.contextId, not this authority.
    // Routine permission loading/refresh must not discard the current draft.
    if (["unauthorized", "user-access-denied", "tenant-access-denied", "invalid-tenant-context", "invalid-projection", "ready-empty"].includes(phase) || (tenant !== null && nextTenant === null && phase === "idle")) {
      clear(); tenant = nextTenant;
    } else if (phase === "ready" && !permission.hasCapability("task.create") && !permission.hasCapability("task.read")) clear();
    else if (phase === "ready" && !permission.hasCapability("connector.use")) selections.value = {};
  }, { immediate: true, flush: "sync" });

  return { texts, selections, workspaceId, newProfile, planProfile, selection, setSelection, clearSelection, clearTarget, preparePlanDraft, clear };
});
