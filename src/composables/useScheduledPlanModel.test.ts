// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { modelDefinitions } from "../domain/chat-models.generated";
import type { ProfileId } from "../api/chat-model-client";
import type { TargetMode } from "../domain/scheduled-plan.generated";
import { useScheduledPlanModel } from "./useScheduledPlanModel";
const client = vi.hoisted(() => ({ catalog: vi.fn(), state: vi.fn() }));
vi.mock("../api/chat-model-client", () => ({ chatModelsEnabled: true, chatModelClient: client }));
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
it.each(["existing_chat", "dedicated_chat"] as const)("reviews the current %s model without issuing a switch", async mode => {
  const { form, model } = setup(mode, mode === "dedicated_chat" ? "dedicated" : null);
  await flushPromises();
  expect(client.state).toHaveBeenCalledExactlyOnceWith("scope", mode === "dedicated_chat" ? "dedicated" : "existing");
  expect(form.modelProfile).toBe("minimax-m3-high-v1");
  expect(model.modelReady.value).toBe(true);
  expect(model.modelLocked.value).toBe(true);
  expect(model.modelNotice.value).toContain("重新授权");
});
it.each(["new_chat_each_run", "dedicated_chat"] as const)("keeps the independent default when %s has no chat", async mode => {
  const { form, model } = setup(mode);
  await flushPromises();
  expect(client.state).not.toHaveBeenCalled();
  expect(form.modelProfile).toBe("kimi-k3-max-v1");
  expect(model.modelLocked.value).toBe(false);
});
it("does not accept an unresolved bound-chat selection", async () => {
  client.state.mockResolvedValue({ profileId: "minimax-m3-high-v1", revision: 2, state: "unknown" });
  const { form, model } = setup("dedicated_chat", "bound");
  await flushPromises();
  expect(form.modelProfile).toBe("kimi-k3-max-v1");
  expect(model.modelReady.value).toBe(false);
});
it("ignores a late bound-chat read after changing the target", async () => {
  let resolve!: (value: unknown) => void;
  client.state.mockReturnValue(new Promise(r => { resolve = r; }));
  const { form, model } = setup("dedicated_chat", "bound");
  await flushPromises();
  form.mode = "new_chat_each_run";
  await flushPromises();
  resolve({ profileId: "minimax-m3-high-v1", revision: 2, state: "ready" });
  await flushPromises();
  expect(form.modelProfile).toBe("kimi-k3-max-v1");
  expect(model.modelReady.value).toBe(true);
  expect(model.modelLocked.value).toBe(false);
});
it("prompts for a chat before attempting to read its model", async () => {
  const { form, model } = setup("existing_chat");
  form.conversationId = null;
  await flushPromises();
  expect(model.modelReady.value).toBe(false);
  expect(model.modelNotice.value).toContain("选择已有聊天后");
});
