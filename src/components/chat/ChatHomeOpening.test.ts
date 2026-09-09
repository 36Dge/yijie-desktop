// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatHomeOpening from "./ChatHomeOpening.vue";

let now=0, sequence=0;
const frames=new Map<number,FrameRequestCallback>();
const wrappers: ReturnType<typeof mount>[]=[];
let media: MediaQueryList;
let hidden=false;
const disconnect=vi.fn();
beforeEach(()=>{
  now=0; sequence=0; hidden=false; frames.clear(); disconnect.mockClear();
  media=Object.assign(new EventTarget(),{matches:false,media:"(prefers-reduced-motion: reduce)"}) as MediaQueryList;
  vi.spyOn(window,"matchMedia").mockReturnValue(media);
  vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  vi.spyOn(performance,"now").mockImplementation(()=>now);
  vi.stubGlobal("requestAnimationFrame",(callback: FrameRequestCallback)=>{frames.set(++sequence,callback);return sequence;});
  vi.stubGlobal("cancelAnimationFrame",(id: number)=>frames.delete(id));
  vi.stubGlobal("ResizeObserver",class { observe() {} disconnect=disconnect; });
});
afterEach(()=>{wrappers.splice(0).forEach(wrapper=>wrapper.unmount());vi.restoreAllMocks();vi.unstubAllGlobals();});
async function advance(ms: number): Promise<void> {
  now+=ms;
  const pending=[...frames.values()]; frames.clear();
  pending.forEach(callback=>callback(now));
  await nextTick();
}
async function setup(skipAnimation=false) {
  const wrapper=mount(ChatHomeOpening,{props:{skipAnimation}}); wrappers.push(wrapper);
  await nextTick(); return wrapper;
}
describe("home opening playback",()=>{
  it("finishes at 2.2 seconds with no idle animation frames",async()=>{
    const wrapper=await setup();
    expect(wrapper.attributes("data-animating")).toBe("true");
    await advance(1200);
    expect(wrapper.findAll(".home-opening__plane")).toHaveLength(3);
    await advance(1000);
    expect(wrapper.attributes("data-animating")).toBe("false");
    expect(wrapper.get("h1").text()).toBe("易界AI");
    expect(wrapper.text()).toContain("让跨境生意，更进一步。");
    expect(frames.size).toBe(0);
  });
  it("replays on each homepage entry and cancels the previous entry's frames",async()=>{
    const visible=ref(true);
    const host=mount(defineComponent({setup:()=>()=>visible.value ? h(ChatHomeOpening) : h("div")}));
    wrappers.push(host); await nextTick();
    await advance(500);
    visible.value=false; await nextTick();
    expect(frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    visible.value=true; await nextTick();
    expect(host.get(".home-opening").attributes("data-animating")).toBe("true");
    expect(frames.size).toBe(1);
    await advance(2200);
    expect(host.get(".home-opening").attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
  });
  it("preserves 2.2s playback and .16s settling after production CSS minification",async()=>{
    vi.spyOn(window,"getComputedStyle").mockReturnValue({
      getPropertyValue:(name: string)=>name==="--yj-motion-home-opening" ? "2.2s" : name==="--yj-motion-home-opening-settle" ? ".16s" : "",
    } as CSSStyleDeclaration);
    const wrapper=await setup();
    await advance(1200);
    expect(wrapper.attributes("data-animating")).toBe("true");
    await advance(1000);
    expect(wrapper.attributes("data-animating")).toBe("false");
    const interrupted=await setup();
    await advance(200);
    interrupted.vm.finish();
    await advance(80);
    expect(interrupted.attributes("data-animating")).toBe("true");
    await advance(80);
    expect(interrupted.attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
  });
  it("shows the final brand immediately for reduced motion or an existing draft",async()=>{
    Object.defineProperty(media,"matches",{value:true,configurable:true});
    const reduced=await setup();
    expect(reduced.attributes("data-animating")).toBe("false");
    Object.defineProperty(media,"matches",{value:false});
    const draft=await setup(true);
    expect(draft.attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
  });
  it("settles within 160ms when the input takes priority",async()=>{
    const wrapper=await setup();
    await advance(200);
    wrapper.vm.finish();
    await advance(80);
    expect(wrapper.attributes("data-animating")).toBe("true");
    await advance(80);
    expect(wrapper.attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
  });
  it("stops immediately when hidden or when reduced motion is enabled",async()=>{
    const wrapper=await setup();
    hidden=true; document.dispatchEvent(new Event("visibilitychange")); await nextTick();
    expect(wrapper.attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
    hidden=false;
    const second=await setup();
    Object.defineProperty(media,"matches",{value:true});
    media.dispatchEvent(new Event("change")); await nextTick();
    expect(second.attributes("data-animating")).toBe("false");
    expect(frames.size).toBe(0);
  });
});
