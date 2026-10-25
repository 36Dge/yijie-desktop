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

it("labels retired history and the explicit recovery action without dispatching on render",async()=>{
 const wrapper=mount(ChatModelControl,{props:{profile:"kimi-k3-max-v1",disabled:false,loading:false,saving:false,error:"切换结果待核实",retryLabel:"恢复原切换",catalog:{schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:true,reason:"ready" as const}))}}});
 try{expect(wrapper.get('.model-trigger').text()).toContain('已退役');expect(wrapper.get('.model-retry').attributes('aria-label')).toBe('恢复原切换');expect(wrapper.emitted('retry')).toBeUndefined();await wrapper.get('.model-retry').trigger('click');expect(wrapper.emitted('retry')).toHaveLength(1);expect(wrapper.emitted('select')).toBeUndefined();}finally{wrapper.unmount();}
});
