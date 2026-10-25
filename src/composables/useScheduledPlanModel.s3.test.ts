// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modelDefinitions } from "../domain/chat-models-v2.generated";
import type { ProfileId } from "../api/chat-model-client";
import type { TargetMode } from "../domain/scheduled-plan-v2.generated";
import { useScheduledPlanModel } from "./useScheduledPlanModel";
const client = vi.hoisted(() => ({ catalog: vi.fn(), state: vi.fn() }));
vi.mock("../api/chat-model-client", () => ({ chatModelsEnabled: true, chatModelClient: client, kimiK31Candidate: true, defaultModelProfile: "kimi-k3-1-pro-max-v1" }));
vi.mock("../stores/chat.store", () => ({ useChatStore: () => ({ context: { contextId: "scope" } }) }));
const roots: ReturnType<typeof mount>[] = [];
function setup(mode: TargetMode, bound: string | null = null) {
  const form = reactive({ modelProfile: "kimi-k3-max-v1" as ProfileId, mode, conversationId: mode === "existing_chat" ? "existing" : null });
  const binding = ref(bound);
  let model!: ReturnType<typeof useScheduledPlanModel>;
  roots.push(mount(defineComponent({ setup() { model = useScheduledPlanModel(form, () => binding.value); return () => null; } })));
  return { form, model, binding };
}
beforeEach(() => {
  vi.resetAllMocks();
  client.catalog.mockResolvedValue({ models: modelDefinitions.map(profile => ({ profile, available: true })) });
  client.state.mockResolvedValue({ profileId: "minimax-m3-high-v1", revision: 2, state: "ready" });
});
afterEach(() => roots.splice(0).forEach(root => root.unmount()));
it("keeps a retired unbound choice visible and requires explicit replacement", async () => {
  const { form, model }=setup("dedicated_chat"); await flushPromises();
  expect(form.modelProfile).toBe("kimi-k3-max-v1");
  expect(model.modelOptions.find(m=>m.value===form.modelProfile)?.disabled).toBe(true);
  expect(model.modelNotice.value).toContain("已退役");
  form.modelProfile="kimi-k3-1-pro-max-v1";
  expect(model.modelOptions.find(m=>m.value===form.modelProfile)?.disabled).toBe(false);
});
it("a retired bound chat remains locked and asks for a confirmed chat change", async () => {
  client.state.mockResolvedValue({profileId:"kimi-k3-max-v1",revision:1,state:"ready"});
  const {form,model}=setup("dedicated_chat","bound"); await flushPromises();
  expect(model.modelLocked.value).toBe(true); expect(form.modelProfile).toBe("kimi-k3-max-v1");
  expect(model.modelNotice.value).toContain("先在聊天中确认");
});
it("uses the new confirmed bound profile without sending a switch", async () => {
  client.state.mockResolvedValue({profileId:"kimi-k3-1-pro-max-v1",revision:2,state:"ready"});
  const {form,model}=setup("existing_chat");await flushPromises();
  expect(form.modelProfile).toBe("kimi-k3-1-pro-max-v1"); expect(model.modelReady.value).toBe(true);
  expect(client.state).toHaveBeenCalledTimes(1); expect(model.modelNotice.value).toContain("重新授权");
});
it("keeps paused Kimi unavailable while MiniMax remains selectable", async () => {
  client.catalog.mockResolvedValue({models:modelDefinitions.map(profile=>({profile,available:profile.profile_id==="minimax-m3-high-v1"}))});
  const {form,model}=setup("new_chat_each_run");await flushPromises();form.modelProfile="kimi-k3-1-pro-max-v1";
  expect(model.modelOptions.find(m=>m.value===form.modelProfile)?.disabled).toBe(true);
  expect(model.modelOptions.find(m=>m.value==="minimax-m3-high-v1")?.disabled).toBe(false);
});
