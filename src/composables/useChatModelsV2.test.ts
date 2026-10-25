// @vitest-environment happy-dom
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, ref } from "vue";
import { expect, it, vi } from "vitest";
import { modelDefinitions } from "../domain/chat-models-v2.generated";
import { useChatModels } from "./useChatModels";
const client=vi.hoisted(()=>({catalog:vi.fn(),state:vi.fn(),select:vi.fn(),recover:vi.fn()}));
vi.mock("../api/chat-model-client",()=>({chatModelsEnabled:true,kimiK31Candidate:true,defaultModelProfile:"kimi-k3-1-pro-max-v1",chatModelClient:client}));
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

it("candidate refresh never dispatches and explicit recovery keeps the original intent",async()=>{
 vi.clearAllMocks();
 client.catalog.mockResolvedValue({schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:true,reason:"ready"}))});
 const operationId=crypto.randomUUID();
 client.state.mockResolvedValue({profileId:"kimi-k3-max-v1",revision:7,state:"unknown",pending:{operationId,profileId:"kimi-k3-1-pro-max-v1",expectedRevision:7,recoveryAvailable:true}});
 let models!:ReturnType<typeof useChatModels>;
 const wrapper=mount(defineComponent({setup(){models=useChatModels(()=>"scope",()=>"session",()=>false);return()=>null;}}));
 try{
  await flushPromises();await models.refresh();expect(client.select).not.toHaveBeenCalled();expect(client.recover).not.toHaveBeenCalled();expect(models.ready.value).toBe(false);expect(models.retryLabel.value).toBe("恢复原切换");
  await models.select("minimax-m3-high-v1");expect(client.select).not.toHaveBeenCalled();
  client.recover.mockResolvedValue({profileId:"minimax-m3-high-v1",revision:9,state:"ready"});
  await models.retry();expect(client.recover).toHaveBeenCalledExactlyOnceWith("scope","session",{profileId:"kimi-k3-1-pro-max-v1",expectedRevision:7},operationId);expect(models.profile.value).toBe("minimax-m3-high-v1");expect(models.intent.value?.expectedRevision).toBe(9);
 }finally{wrapper.unmount();}
});
it("candidate old pending and unknown dispatch proof allow refresh only",async()=>{
 vi.clearAllMocks();client.state.mockResolvedValue({profileId:"kimi-k3-max-v1",revision:7,state:"unknown",pending:{operationId:crypto.randomUUID(),profileId:"minimax-m3-high-v1",expectedRevision:7,recoveryAvailable:false}});
 let models!:ReturnType<typeof useChatModels>;
 const wrapper=mount(defineComponent({setup(){models=useChatModels(()=>"scope",()=>"old",()=>false);return()=>null;}}));
 try{await flushPromises();expect(models.retryLabel.value).toBe("刷新状态");await models.retry();expect(client.recover).not.toHaveBeenCalled();expect(client.select).not.toHaveBeenCalled();expect(models.ready.value).toBe(false);}finally{wrapper.unmount();}
});
it("candidate discards late recovery after navigation",async()=>{
 vi.clearAllMocks();const session=ref("first");client.state.mockResolvedValueOnce({profileId:"kimi-k3-max-v1",revision:7,state:"unknown",pending:{operationId:crypto.randomUUID(),profileId:"kimi-k3-1-pro-max-v1",expectedRevision:7,recoveryAvailable:true}}).mockResolvedValue({profileId:"minimax-m3-high-v1",revision:2,state:"ready"});
 let resolve!:(value:unknown)=>void;client.recover.mockReturnValue(new Promise(r=>{resolve=r;}));let models!:ReturnType<typeof useChatModels>;
 const wrapper=mount(defineComponent({setup(){models=useChatModels(()=>"scope",()=>session.value,()=>false);return()=>null;}}));
 try{await flushPromises();const attempt=models.retry();session.value="second";await flushPromises();resolve({profileId:"kimi-k3-1-pro-max-v1",revision:8,state:"ready"});await attempt;expect(models.profile.value).toBe("minimax-m3-high-v1");expect(models.intent.value?.expectedRevision).toBe(2);}finally{wrapper.unmount();}
});
