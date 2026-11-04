import { ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import { defaultModelProfile, type ProfileId } from "../api/chat-model-client";
import { createChatComposerDrafts, clearChatComposerDraft, updateChatComposerDraft, type ChatComposerDraftKey } from "../domain/chat-composer-draft";
import type { CatalogEntry, ExpertDisplay } from "../domain/experts-v2.generated";
import { expertDefaultPrompt } from "../domain/expert-composer";
import type { SelectionDisplay } from "../domain/market-connectors.generated";
import type { SelectedChatSkill } from "../domain/chat-skills";
import { usePermissionStore } from "./permission.store";

/** In-memory drafts survive page navigation, never account logout or scope changes. */
export const useChatComposerDraftStore = defineStore("chat-composer-drafts", () => {
  const permission = usePermissionStore();
  const texts = shallowRef(createChatComposerDrafts());
  // Only untouched automatic copy may be replaced on the next expert choice.
  // This provenance is in memory, just like the drafts themselves.
  const expertPrompts = new Map<ChatComposerDraftKey, string>();
  watch(texts, next => {
    for (const [target, prompt] of expertPrompts) {
      if (next[target] !== prompt) expertPrompts.delete(target);
    }
  }, { flush: "sync" });
  function prefillExpertPrompt(target: ChatComposerDraftKey, entry: CatalogEntry): void {
    const current = texts.value[target] ?? "";
    if (current.trim().length > 0 && expertPrompts.get(target) !== current) return;
    const prompt = expertDefaultPrompt(entry);
    texts.value = updateChatComposerDraft(texts.value, target, prompt);
    expertPrompts.set(target, prompt);
  }
  function clearExpertPrompt(target: ChatComposerDraftKey): void {
    if (expertPrompts.has(target) && texts.value[target] === expertPrompts.get(target)) {
      texts.value = clearChatComposerDraft(texts.value, target);
    }
    expertPrompts.delete(target);
  }
  const selections = shallowRef<Readonly<Partial<Record<ChatComposerDraftKey, readonly SelectionDisplay[]>>>>({});
  const experts = shallowRef<Readonly<Partial<Record<ChatComposerDraftKey, ExpertDisplay>>>>({});
  const skills = shallowRef<Readonly<Partial<Record<ChatComposerDraftKey, readonly SelectedChatSkill[]>>>>({});
  function skillSelection(target: ChatComposerDraftKey): readonly SelectedChatSkill[] { return skills.value[target] ?? []; }
  function setSkills(target: ChatComposerDraftKey, values: readonly SelectedChatSkill[]): void {
    skills.value = { ...skills.value, [target]: Object.freeze(values.map(value => Object.freeze({ ...value }))) };
  }
  function clearSkills(target: ChatComposerDraftKey): void { const next = { ...skills.value }; delete next[target]; skills.value = next; }
  function expert(target: ChatComposerDraftKey): ExpertDisplay | null { return experts.value[target] ?? null; }
  function setExpert(target: ChatComposerDraftKey, value: ExpertDisplay | null): void { const next = { ...experts.value }; if (value) next[target] = Object.freeze({ ...value }); else { delete next[target]; clearExpertPrompt(target); } experts.value = next; }
  const workspaceId = ref<string | null>(null);
  const newProfile = ref<ProfileId>(defaultModelProfile);
  const planProfile = ref<ProfileId>(defaultModelProfile);
  let tenant: string | null = null;

  function clear(): void {
    expertPrompts.clear();
    texts.value = createChatComposerDrafts(); selections.value = {}; experts.value = {}; skills.value = {}; workspaceId.value = null;
    newProfile.value = defaultModelProfile; planProfile.value = defaultModelProfile;
  }
  function selection(target: ChatComposerDraftKey): readonly SelectionDisplay[] { return selections.value[target] ?? []; }
  function setSelection(target: ChatComposerDraftKey, values: readonly SelectionDisplay[]): void {
    selections.value = { ...selections.value, [target]: Object.freeze(values.map(value => Object.freeze({ ...value, reference: Object.freeze({ ...value.reference }) }))) };
  }
  function clearSelection(target: ChatComposerDraftKey): void { const next = { ...selections.value }; delete next[target]; selections.value = next; }
  function clearTarget(target: ChatComposerDraftKey): void { texts.value = clearChatComposerDraft(texts.value, target); clearSelection(target); clearSkills(target); setExpert(target, null); }
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

  return { texts, experts, expert, setExpert, prefillExpertPrompt, clearExpertPrompt, selections, skills, skillSelection, setSkills, clearSkills, workspaceId, newProfile, planProfile, selection, setSelection, clearSelection, clearTarget, preparePlanDraft, clear };
});
