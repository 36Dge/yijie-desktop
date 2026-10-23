import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { updateChatComposerDraft } from "../domain/chat-composer-draft";
import { useChatComposerDraftStore } from "./chat-composer-drafts.store";
import type { PermissionPhase } from "../domain/permissions";
import { installedSkill } from "../test/skill-fixture";
import { expertEntry } from "../test/expert-fixture";

const permission = reactive({ selectedTenantId: "scope-a" as string | null, phase: "ready" as PermissionPhase, capabilities: ["task.create", "task.read", "connector.use"], hasCapability(capability: string) { return this.capabilities.includes(capability); } });
vi.mock("./permission.store", () => ({ usePermissionStore: () => permission }));
beforeEach(() => { setActivePinia(createPinia()); permission.selectedTenantId = "scope-a"; permission.phase = "ready"; permission.capabilities = ["task.create", "task.read", "connector.use"]; });

describe("connector-aware in-memory composer drafts", () => {
  it("replaces untouched expert prompts but preserves user edits, even after reverting their text", () => {
    const store = useChatComposerDraftStore();
    const second = { ...expertEntry, quickPrompts: ["规划新品推广"] };
    store.prefillExpertPrompt("new", expertEntry);
    expect(store.texts.new).toBe("整理当前任务");
    store.prefillExpertPrompt("new", second);
    expect(store.texts.new).toBe("规划新品推广");
    store.texts = updateChatComposerDraft(store.texts, "new", "规划我的新品推广");
    store.texts = updateChatComposerDraft(store.texts, "new", "规划新品推广");
    store.prefillExpertPrompt("new", expertEntry);
    expect(store.texts.new).toBe("规划新品推广");
    store.clearExpertPrompt("new");
    expect(store.texts.new).toBe("规划新品推广");
  });
  it("isolates defaults by conversation, removes only automatic copy and clears provenance on logout", () => {
    const store = useChatComposerDraftStore();
    store.prefillExpertPrompt("new", expertEntry);
    store.prefillExpertPrompt("session:one", { ...expertEntry, quickPrompts: ["会话问题"] });
    store.setExpert("new", null);
    expect(store.texts.new).toBeUndefined(); expect(store.texts["session:one"]).toBe("会话问题");
    store.clearTarget("session:one"); expect(store.texts).toEqual({});
    store.prefillExpertPrompt("new", expertEntry);
    permission.phase = "unauthorized";
    expect(store.texts).toEqual({});
    store.texts = updateChatComposerDraft(store.texts, "new", "整理当前任务");
    store.prefillExpertPrompt("new", { ...expertEntry, quickPrompts: ["另一问题"] });
    expect(store.texts.new).toBe("整理当前任务");
  });
  it("uses original catalog copy and supplies a task-oriented fallback for catalogs without questions", () => {
    const store = useChatComposerDraftStore();
    store.prefillExpertPrompt("new", { ...expertEntry, quickPrompts: [" ", " 请整理任务。 "] });
    expect(store.texts.new).toBe(" 请整理任务。 ");
    store.prefillExpertPrompt("new", { ...expertEntry, quickPrompts: [] });
    expect(store.texts.new).toBe("请以普通合成专家的专业视角，先确认我的任务目标和所需资料，再给出具体方案。");
  });
  it("isolates skill choices per draft, preserves navigation, and clears them on logout or accepted submission", () => {
    const store = useChatComposerDraftStore();
    store.setSkills("new", [installedSkill]);
    expect(store.skillSelection("plan:new")).toEqual([]);
    permission.phase = "loading"; permission.phase = "ready";
    expect(store.skillSelection("new")).toHaveLength(1);
    store.clearTarget("new"); expect(store.skillSelection("new")).toEqual([]);
    store.setSkills("new", [installedSkill]);
    permission.selectedTenantId = "scope-b";
    expect(store.skillSelection("new")).toEqual([]);
  });
  it("copies only ordinary text into a fresh plan draft and preserves an existing plan", () => {
    const store = useChatComposerDraftStore();
    store.texts = updateChatComposerDraft(store.texts, "new", "每天整理公开资料");
    store.workspaceId = "ordinary-workspace"; store.newProfile = "minimax-m3-high-v1";
    store.setSelection("new", [{ serviceId: "sample", displayName: "普通合成服务", reference: { installationId: "019c1a00-0000-7000-8000-000000000001", revision: 1, generation: 1 } }]);
    store.preparePlanDraft();
    expect(store.texts["plan:new"]).toBe("每天整理公开资料"); expect(store.texts.new).toBe("每天整理公开资料");
    expect(store.selection("plan:new")).toEqual([]); expect(store.selection("new")).toHaveLength(1);
    expect(store.planProfile).toBe("kimi-k3-max-v1"); expect(store.workspaceId).toBe("ordinary-workspace");
    store.texts = updateChatComposerDraft(store.texts, "plan:new", "已编辑的计划"); store.preparePlanDraft();
    expect(store.texts["plan:new"]).toBe("已编辑的计划");
  });
  it("preserves navigation/loading state but clears drafts on tenant change and logout", () => {
    const store = useChatComposerDraftStore();
    store.texts = updateChatComposerDraft(store.texts, "new", "保留管理往返草稿"); store.newProfile = "minimax-m3-high-v1"; store.workspaceId = "project-a";
    permission.phase = "loading"; permission.phase = "ready";
    expect(store.texts.new).toBe("保留管理往返草稿"); expect(store.newProfile).toBe("minimax-m3-high-v1");
    permission.selectedTenantId = "scope-b";
    expect(store.texts).toEqual({}); expect(store.workspaceId).toBeNull();
    store.texts = updateChatComposerDraft(store.texts, "new", "账户二草稿");
    permission.phase = "idle"; permission.selectedTenantId = null;
    expect(store.texts).toEqual({});
  });
});
