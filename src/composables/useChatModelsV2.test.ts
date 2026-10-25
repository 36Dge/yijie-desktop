// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { expect, it, vi } from "vitest";
import { modelDefinitions } from "../domain/chat-models-v2.generated";
import { useChatModels } from "./useChatModels";
const client=vi.hoisted(()=>({catalog:vi.fn(),state:vi.fn(),select:vi.fn()}));
vi.mock("../api/chat-model-client",()=>({chatModelsEnabled:true,defaultModelProfile:"kimi-k3-1-pro-max-v1",chatModelClient:client}));
it("candidate draft/reset/scope changes keep the new identity and pause requires explicit MiniMax selection",async()=>{
 client.catalog.mockResolvedValue({schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:profile.provider!=="kimi",reason:profile.provider==="kimi"?"activation_required":"ready"}))});
 const scope=ref("first");let models!:ReturnType<typeof useChatModels>;
 const wrapper=mount(defineComponent({setup(){models=useChatModels(()=>scope.value,()=>null,()=>false);return()=>null;}}));
 try {
  await flushPromises();expect(models.profile.value).toBe("kimi-k3-1-pro-max-v1");expect(models.ready.value).toBe(false);expect(models.intent.value).toBeUndefined();
  await models.select("kimi-k3-max-v1");expect(models.profile.value).toBe("kimi-k3-1-pro-max-v1");
  await models.select("minimax-m3-high-v1");expect(models.intent.value?.profileId).toBe("minimax-m3-high-v1");
  models.resetNew();expect(models.profile.value).toBe("kimi-k3-1-pro-max-v1");
  await models.select("minimax-m3-high-v1");scope.value="second";await flushPromises();expect(models.profile.value).toBe("kimi-k3-1-pro-max-v1");
  expect(client.select).not.toHaveBeenCalled();
 } finally {wrapper.unmount();}
});
