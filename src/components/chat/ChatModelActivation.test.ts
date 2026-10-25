// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { modelDefinitions } from "../../domain/chat-models-v2.generated";
import ChatModelControl from "./ChatModelControl.vue";

it("explains paused execution without claiming missing credentials",()=>{
 const wrapper=mount(ChatModelControl,{props:{profile:"kimi-k3-1-pro-max-v1",disabled:false,loading:false,saving:false,error:"",catalog:{schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:profile.provider!=="kimi",reason:profile.provider==="kimi"?"activation_required" as const:"ready" as const}))}}});
 try {expect(wrapper.get('.model-trigger').attributes('title')).toBe('模型暂未启用，请选择可用模型');expect(wrapper.get('[role="status"]').text()).toBe('模型暂未启用');expect(wrapper.emitted('select')).toBeUndefined();}
 finally {wrapper.unmount();}
});
