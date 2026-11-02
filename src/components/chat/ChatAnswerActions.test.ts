// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { readFileSync } from "node:fs";
import ChatAnswerActions from "./ChatAnswerActions.vue";
enableAutoUnmount(afterEach);
afterEach(()=>vi.useRealTimers());
const text="**真实原文** [资料](https://example.org)";
function render() {
  const writeText=vi.fn(async()=>{});
  const wrapper=mount(ChatAnswerActions,{attachTo:document.body,props:{identity:"session:turn:answer",text,adapter:{writeText},modelProfileId:"kimi-k3-1-pro-max-v1",completedAt:new Date(2026,10,2,11,39).getTime()/1000}});
  return {wrapper,writeText};
}
const panel=()=>document.querySelector<HTMLElement>('[role="dialog"]')!;
const button=(label:string)=>[...panel().querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label)!;
describe("local answer actions",()=>{
  it("copies exact Markdown with a brief success check and keeps model/time beside the controls",async()=>{
    vi.useFakeTimers(); const {wrapper,writeText}=render();
    await wrapper.get('[aria-label="复制"]').trigger('click'); await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
    expect(wrapper.get('.chat-copy-action').classes()).toContain('chat-copy-action--success');
    expect(wrapper.get('[aria-label="本轮使用的模型"]').text()).toBe('Kimi K3.1 Pro');
    expect(wrapper.get('time').attributes('datetime')).toBe(new Date(2026,10,2,11,39).toISOString());
    expect(wrapper.findAll('.chat-answer-action svg').every(icon=>icon.attributes('stroke-width')==='1.5')).toBe(true);
    await vi.advanceTimersByTimeAsync(2001);
    expect(wrapper.get('.chat-copy-action').classes()).toContain('chat-copy-action--idle');
  });
  it("toggles likes, cancels a draft without changing the vote, and confirms only selected reasons",async()=>{
    const {wrapper,writeText}=render();
    const up=wrapper.get('[aria-label="点赞"]'),down=wrapper.get('[aria-label="点踩"]');
    await up.trigger('click'); expect(up.attributes('aria-pressed')).toBe('true');
    await down.trigger('click'); await flushPromises();
    expect(panel().querySelectorAll('[role="checkbox"]')).toHaveLength(6);
    expect(panel().textContent).not.toContain('其他原因'); expect(button('确认反馈').disabled).toBe(true);
    button('回答模糊/不具体').click(); await nextTick();
    expect(button('确认反馈').disabled).toBe(false);
    panel().dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await flushPromises();
    expect(up.attributes('aria-pressed')).toBe('true'); expect(down.attributes('aria-pressed')).toBe('false');
    await down.trigger('click'); await flushPromises();
    button('上下文理解错误').click(); button('回答不专业').click(); await nextTick(); button('确认反馈').click(); await flushPromises();
    expect(up.attributes('aria-pressed')).toBe('false'); expect(down.attributes('aria-pressed')).toBe('true');
    await down.trigger('click'); expect(down.attributes('aria-pressed')).toBe('false');
    expect(writeText).not.toHaveBeenCalled(); expect(wrapper.emitted()).not.toHaveProperty('submit');
    expect(wrapper.props('text')).toBe(text);
  });
  it("isolates feedback by answer identity and clears it when the answer changes",async()=>{
    const {wrapper}=render(); await wrapper.get('[aria-label="点赞"]').trigger('click');
    await wrapper.setProps({identity:'another-answer'});
    expect(wrapper.get('[aria-label="点赞"]').attributes('aria-pressed')).toBe('false');
    await wrapper.get('[aria-label="点赞"]').trigger('click'); await wrapper.setProps({text:'修订后的普通正文'});
    expect(wrapper.get('[aria-label="点赞"]').attributes('aria-pressed')).toBe('false');
  });
  it("keeps copy a plain action and exposes toggle/disclosure state only where applicable",()=>{
    const {wrapper}=render();
    expect(wrapper.get('[aria-label="复制"]').attributes('aria-pressed')).toBeUndefined();
    expect(wrapper.get('[aria-label="复制"]').attributes('aria-expanded')).toBeUndefined();
    expect(wrapper.get('[aria-label="点赞"]').attributes('aria-pressed')).toBe('false');
    expect(wrapper.get('[aria-label="点赞"]').attributes('aria-expanded')).toBeUndefined();
    expect(wrapper.get('[aria-label="点踩"]').attributes('aria-expanded')).toBe('false');
  });
  it("has no feedback transport, persistence or model invocation path",()=>{
    const source=readFileSync('src/components/chat/ChatAnswerActions.vue','utf8');
    expect(source).not.toMatch(/@tauri-apps|\bfetch\(|\binvoke\(|chatModelClient|submitTurn|createSession|localStorage|sessionStorage|defineEmits/);
    const {wrapper}=render(); expect(wrapper.findAll('button').every(b=>b.attributes('type')==='button')).toBe(true);
  });
});
