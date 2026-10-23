import { createPinia, setActivePinia } from "pinia";
import { effectScope, reactive } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useExpertsStore } from "../stores/experts.store";
import { useChatExpertsStore } from "../stores/chat-experts.store";
import { useChatComposerDraftStore } from "../stores/chat-composer-drafts.store";
import { expertNativeClient } from "../api/expert-native-client";
import { expertDisplay, expertEntry, expertSnapshot, expertTestId } from "../test/expert-fixture";
import { useChatExpertPicker } from "./useChatExpertPicker";

const route = vi.hoisted(() => ({ value: {} as { fullPath: string } }));
vi.mock("vue-router", () => ({ useRoute: () => route.value }));
const scopes: ReturnType<typeof effectScope>[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  route.value = reactive({ fullPath: "/chat" });
  const resources = useExpertsStore();
  resources.scope = "scope"; resources.contextId = expertTestId(1);
  resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  useChatExpertsStore().bind(expertTestId(1), "scope");
});
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks(); });
function setup(session: string | null = null, disabled = () => false) {
  const scope = effectScope(); scopes.push(scope);
  return scope.run(() => useChatExpertPicker(() => session, disabled))!;
}
it("prefills a ready expert, updates untouched copy on switching, and refills an empty re-selection", async () => {
  const drafts = useChatComposerDraftStore(), resources = useExpertsStore(), flow = setup();
  const second = { ...expertEntry, display: { ...expertDisplay, expertId: "another-expert" }, quickPrompts: ["帮我规划选题"], state: "ready" as const };
  resources.snapshot!.experts.push(second);
  const submit = vi.spyOn(expertNativeClient, "submit");
  expect(await flow.select(expertEntry)).toBe(true);
  expect(drafts.texts.new).toBe(expertEntry.quickPrompts[0]);
  expect(await flow.select(second)).toBe(true);
  expect(drafts.texts.new).toBe("帮我规划选题");
  drafts.texts = {} as typeof drafts.texts;
  expect(await flow.select(second)).toBe(true);
  expect(drafts.texts.new).toBe("帮我规划选题");
  expect(submit).not.toHaveBeenCalled();
});
it("selects a new draft expert without navigation or submission and preserves all draft content", async () => {
  const drafts = useChatComposerDraftStore();
  drafts.texts = { new: "保留正文" } as typeof drafts.texts;
  drafts.setExpert("new", { ...expertDisplay, expertId: "previous" });
  const submit = vi.spyOn(expertNativeClient, "submit"), bind = vi.spyOn(expertNativeClient, "setBinding");
  expect(await setup().select(expertEntry)).toBe(true);
  expect(drafts.expert("new")).toEqual(expertDisplay);
  expect(drafts.texts.new).toBe("保留正文");
  expect(route.value.fullPath).toBe("/chat");
  expect(submit).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
});
it("prepares an available resource before selecting its exact ready version", async () => {
  const resources = useExpertsStore(), drafts = useChatComposerDraftStore();
  resources.snapshot = { ...expertSnapshot(), executionAvailable: true };
  let done!: (ready: boolean) => void;
  const prepare = vi.spyOn(resources, "execute").mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const flow = setup(), request = flow.select(expertEntry);
  expect(flow.pending.value).toBe(true); expect(drafts.expert("new")).toBeNull();
  expect(drafts.texts.new).toBeUndefined();
  expect(await flow.select(expertEntry)).toBe(false);
  resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  done(true);
  expect(await request).toBe(true);
  expect(prepare).toHaveBeenCalledExactlyOnceWith(expertDisplay, "prepare");
  expect(drafts.expert("new")).toEqual(expertDisplay);
  expect(drafts.texts.new).toBe(expertEntry.quickPrompts[0]);
});
it.each(["route", "context", "dispose"] as const)("does not apply a late prepared selection after %s changes", async change => {
  const resources = useExpertsStore();
  resources.snapshot = { ...expertSnapshot(), executionAvailable: true };
  let done!: (ready: boolean) => void;
  vi.spyOn(resources, "execute").mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const flow = setup(), request = flow.select(expertEntry);
  if (change === "route") route.value.fullPath = "/chat/another";
  else if (change === "context") resources.contextId = expertTestId(3);
  else scopes[0]!.stop();
  resources.snapshot = { ...expertSnapshot({ ...expertEntry, state: "ready" }), executionAvailable: true };
  done(true);
  expect(await request).toBe(false);
  expect(useChatComposerDraftStore().expert("new")).toBeNull();
  expect(useChatComposerDraftStore().texts).toEqual({});
});
it("keeps an existing session selection until its normal binding receipt arrives", async () => {
  const id = expertTestId(2), bindings = useChatExpertsStore();
  bindings.bindings = { [id]: { sessionId: id, managed: true, bindingRevision: 1, expert: null, state: "none" } };
  let done!: (applied: boolean) => void;
  const select = vi.spyOn(bindings, "select").mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const flow = setup(id), request = flow.select(expertEntry);
  expect(select).toHaveBeenCalledExactlyOnceWith(id, expertDisplay);
  expect(bindings.bindings[id]?.expert).toBeNull();
  expect(useChatComposerDraftStore().texts).toEqual({});
  bindings.bindings = { [id]: { sessionId: id, managed: true, bindingRevision: 2, expert: expertDisplay, state: "ready" } };
  done(true);
  expect(await request).toBe(true);
  expect(useChatComposerDraftStore().expert("new")).toBeNull();
  expect(useChatComposerDraftStore().texts[`session:${id}`]).toBe(expertEntry.quickPrompts[0]);
});
it("preserves text entered while an existing session binding is completing", async () => {
  const id = expertTestId(2), bindings = useChatExpertsStore(), drafts = useChatComposerDraftStore();
  let done!: (applied: boolean) => void;
  vi.spyOn(bindings, "select").mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const request = setup(id).select(expertEntry);
  drafts.texts = { [`session:${id}`]: "等待期间写的任务" } as typeof drafts.texts;
  done(true); expect(await request).toBe(true);
  expect(drafts.texts[`session:${id}`]).toBe("等待期间写的任务");
});
it("keeps a failed binding unselected and blocks restricted or unsettled resources", async () => {
  const id = expertTestId(2), bindings = useChatExpertsStore(), resources = useExpertsStore();
  const select = vi.spyOn(bindings, "select").mockResolvedValue(false);
  bindings.errors = { [id]: "当前会话暂不可切换" };
  const flow = setup(id);
  expect(await flow.select(expertEntry)).toBe(false);
  expect(flow.error.value).toBe("当前会话暂不可切换");
  expect(await setup(null, () => true).select(expertEntry)).toBe(false);
  resources.operations = { [`${expertDisplay.expertId}@${expertDisplay.version}`]: { operationId: expertTestId(4), expert: expertDisplay, action: "prepare", state: "unknown" } };
  expect(await flow.select(expertEntry)).toBe(false);
  expect(select).toHaveBeenCalledTimes(1);
  expect(useChatComposerDraftStore().texts).toEqual({});
});
