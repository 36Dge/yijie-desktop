// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { modelDefinitions } from "../../domain/chat-models-v2.generated";
import ChatModelControl from "./ChatModelControl.vue";

it("explains paused execution without claiming missing credentials",async()=>{
 const wrapper=mount(ChatModelControl,{props:{profile:"kimi-k3-1-pro-max-v1",disabled:false,loading:false,saving:false,catalog:{schema_version:2,default_profile:"kimi-k3-1-pro-max-v1",models:modelDefinitions.map(profile=>({profile,available:profile.provider!=="kimi",reason:profile.provider==="kimi"?"activation_required" as const:"ready" as const}))}}});
 try {
  const trigger = wrapper.get('.model-trigger');
  await trigger.trigger('mouseenter'); await flushPromises();
  expect(trigger.attributes('aria-describedby')).toBeUndefined();
  expect(trigger.attributes('data-yj-tooltip')).toBeUndefined();
  expect(wrapper.get('[role="status"]').text()).toBe('模型暂未启用');expect(wrapper.emitted('select')).toBeUndefined();}
 finally {wrapper.unmount();}
});

it("keeps the confirmed model and its retired label visible during a refresh", async () => {
  const wrapper = mount(ChatModelControl, { props: {
    profile: "kimi-k3-max-v1", disabled: false, loading: false, saving: false,
    catalog: { schema_version: 2, default_profile: "kimi-k3-1-pro-max-v1", models: [] },
  } });
  try {
    const trigger = wrapper.get(".model-trigger");
    expect(trigger.text()).toContain("已退役");
    await wrapper.setProps({ loading: true });
    expect(trigger.text()).toContain("已退役");
    expect(trigger.attributes("aria-label")).toContain("Kimi-K3（已退役）");
    expect(wrapper.get('[role="status"]').text()).toBe("模型加载中");
    expect(wrapper.emitted("select")).toBeUndefined();
    await wrapper.setProps({ profile: null });
    expect(trigger.text()).toBe("模型加载中");
  } finally { wrapper.unmount(); }
});
