import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { updateChatComposerDraft } from "../domain/chat-composer-draft";
import { useChatComposerDraftStore } from "./chat-composer-drafts.store";
import type { PermissionPhase } from "../domain/permissions";

const permission = reactive({ selectedTenantId: "scope-a" as string | null, phase: "ready" as PermissionPhase, capabilities: ["task.create", "task.read", "connector.use"], hasCapability(capability: string) { return this.capabilities.includes(capability); } });
vi.mock("./permission.store", () => ({ usePermissionStore: () => permission }));
beforeEach(() => { setActivePinia(createPinia()); permission.selectedTenantId = "scope-a"; permission.phase = "ready"; permission.capabilities = ["task.create", "task.read", "connector.use"]; });

describe("connector-aware in-memory composer drafts", () => {
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
