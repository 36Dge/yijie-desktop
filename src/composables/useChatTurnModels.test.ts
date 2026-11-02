// @vitest-environment happy-dom
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useChatTurnModels } from "./useChatTurnModels";
import type { readTurnModel } from "../api/chat-turn-model-client";
function harness(read: typeof readTurnModel) {
  const scope=ref({contextId:"context",sessionId:"session"}); const ids=ref(["turn"]);
  const wrapper=mount(defineComponent({setup(){const models=useChatTurnModels({scope:()=>scope.value,turnIds:()=>ids.value,read});return ()=>h('div',JSON.stringify(models.value));}}));
  return {wrapper,scope,ids};
}
describe("immutable answer model reads",()=>{
  it("loads each answer once and does not refetch when the same turn list rerenders",async()=>{
    const read=vi.fn(async(_context,sessionId,turnId)=>({sessionId,turnId,profileId:"kimi-k3-1-pro-max-v1"}));
    const {wrapper,ids}=harness(read); await flushPromises(); expect(wrapper.text()).toContain('kimi-k3-1-pro-max-v1');
    ids.value=["turn"]; await flushPromises(); expect(read).toHaveBeenCalledTimes(1);
    ids.value=["turn","second"]; await flushPromises(); expect(read).toHaveBeenCalledTimes(2); wrapper.unmount();
  });
  it("ignores a late response from a prior scope",async()=>{
    let finish!: (value:{sessionId:string;turnId:string;profileId:string})=>void;
    const read=vi.fn().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockImplementation(async(_context,sessionId,turnId)=>({sessionId,turnId,profileId:"minimax-m3-high-v1"}));
    const {wrapper,scope}=harness(read); scope.value={contextId:"new",sessionId:"other"}; await flushPromises();
    finish({sessionId:"session",turnId:"turn",profileId:"kimi-k3-1-pro-max-v1"}); await flushPromises();
    expect(wrapper.text()).toContain('minimax-m3-high-v1'); expect(wrapper.text()).not.toContain('kimi'); wrapper.unmount();
  });
});
