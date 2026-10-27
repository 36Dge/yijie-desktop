// @vitest-environment happy-dom
import { mount, type VueWrapper } from "@vue/test-utils";
import { h, nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatSafeContent from "../components/chat/ChatSafeContent.vue";

const blocks = (text: string, identity = "message") => [{ identity, blockIndex: 0, type: "text" as const, text }];
let now = 0;
let sequence = 0;
let frames: Map<number, FrameRequestCallback>;
let media: MediaQueryList;
const wrappers: VueWrapper[] = [];
function mountContent(text = "", streaming = true) {
  const wrapper = mount(ChatSafeContent, { attachTo: document.body, props: { blocks: blocks(text), streaming } });
  wrappers.push(wrapper);
  return wrapper;
}
async function frame(ms = 16) {
  now += ms;
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => callback(now));
  await nextTick();
}
beforeEach(() => {
  now = 0;
  sequence = 0;
  frames = new Map();
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(() => {
  document.getSelection()?.removeAllRanges();
  wrappers.splice(0).forEach(wrapper => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("message stream presentation", () => {
  it("spreads a burst across frames in Markdown order and catches up within 180ms", async () => {
    const wrapper = mountContent("前文。");
    const paragraph = wrapper.get("p").element;
    const text = "前文。" + "连续输出的内容".repeat(12) + "\n\n## 后续标题\n\n- **要点**\n  - 子项\n\n```js\nconst value = 1;\n```";
    await wrapper.setProps({ blocks: blocks(text) });
    expect(wrapper.text()).toBe("前文。");
    await frame();
    const first = wrapper.text();
    expect(first.length).toBeGreaterThan(3);
    expect(first.length).toBeLessThan(text.length);
    expect(wrapper.find("h2").exists()).toBe(false);
    expect(wrapper.get("p").element).toBe(paragraph);
    await frame();
    expect(wrapper.text().length).toBeGreaterThan(first.length);
    await frame(148);
    expect(wrapper.get("h2").text()).toBe("后续标题");
    expect(wrapper.get("li strong").text()).toBe("要点");
    expect(wrapper.get("li li").text()).toBe("子项");
    expect(wrapper.get("pre code").text()).toBe("const value = 1;");
    expect(frames.size).toBe(0);
  });

  it("adapts to consecutive bursts without losing, duplicating or reordering text", async () => {
    const wrapper = mountContent();
    let text = "";
    for (let index = 0; index < 20; index++) {
      text += `${index}：连续文字。`;
      await wrapper.setProps({ blocks: blocks(text) });
      await frame(32);
      expect(text.startsWith(wrapper.text())).toBe(true);
      expect(frames.size).toBeLessThanOrEqual(1);
    }
    await frame(180);
    expect(wrapper.text()).toBe(text);
    expect(frames.size).toBe(0);
  });

  it("uses one cursor across appended content blocks and preserves complete code for copying", async () => {
    const wrapper = mount(ChatSafeContent, {
      props: { blocks: blocks("前文"), streaming: true },
      slots: { "code-actions": ({ text }) => h("button", { "data-copy": text }, "复制代码") },
    });
    wrappers.push(wrapper);
    const code = "const value = 123;\n".repeat(10);
    await wrapper.setProps({ blocks: [
      ...blocks("前文" + "连续追加".repeat(20)),
      { identity: "code", blockIndex: 1, type: "code", language: "ts", text: code },
    ] });
    await frame(32);
    expect(wrapper.find("pre").exists()).toBe(false);
    await frame(70);
    expect(wrapper.get("pre").text().length).toBeLessThan(code.trim().length);
    expect(wrapper.get("button").attributes("data-copy")).toBe(code);
    await frame(78);
    expect(wrapper.get("pre code").element.textContent).toBe(code);
    expect(frames.size).toBe(0);
  });

  it("renders an existing live snapshot without replaying it and drains a long burst in bounded time", async () => {
    const existing = "已经存在的完整内容。".repeat(1000);
    const wrapper = mountContent(existing);
    expect(wrapper.text()).toBe(existing);
    expect(frames.size).toBe(0);
    const appended = existing + "新到达的正文。".repeat(1000);
    await wrapper.setProps({ blocks: blocks(appended) });
    await frame(16);
    expect(wrapper.text().length).toBeGreaterThan(existing.length);
    expect(wrapper.text().length).toBeLessThan(appended.length);
    await frame(164);
    expect(wrapper.text()).toBe(appended);
    expect(frames.size).toBe(0);
  });

  it("never slices emoji, flags or combining characters", async () => {
    const wrapper = mountContent();
    const glyphs = ["👩🏽‍💻", "🇨🇳", "e\u0301", "🌍", "中"];
    await wrapper.setProps({ blocks: blocks(glyphs.join("")) });
    const prefixes = new Set(["", ...glyphs.map((_, index) => glyphs.slice(0, index + 1).join(""))]);
    for (let index = 0; index < 12; index++) {
      await frame();
      expect(prefixes.has(wrapper.text())).toBe(true);
    }
    expect(wrapper.text()).toBe(glyphs.join(""));
  });

  it("flushes on completion, interruption, replacement and identity changes without stale callbacks", async () => {
    const wrapper = mountContent("旧内容");
    await wrapper.setProps({ blocks: blocks("旧内容" + "追加".repeat(40)) });
    await frame();
    await wrapper.setProps({ streaming: false });
    expect(wrapper.text()).toBe("旧内容" + "追加".repeat(40));
    expect(frames.size).toBe(0);
    await wrapper.setProps({ streaming: true });
    expect(frames.size).toBe(0);
    await wrapper.setProps({ blocks: blocks("替换内容") });
    expect(wrapper.text()).toBe("替换内容");
    await wrapper.setProps({ blocks: blocks("替换内容追加") });
    await wrapper.setProps({ blocks: blocks("另一条消息", "new-message") });
    await frame(200);
    expect(wrapper.text()).toBe("另一条消息");
    expect(frames.size).toBe(0);
  });

  it("renders history and reduced-motion content immediately, and flushes when the preference changes", async () => {
    const history = mountContent("历史内容", false);
    await history.setProps({ blocks: blocks("完整历史内容") });
    expect(history.text()).toBe("完整历史内容");
    const live = mountContent();
    await live.setProps({ blocks: blocks("新增内容".repeat(30)) });
    Object.defineProperty(media, "matches", { configurable: true, value: true });
    media.dispatchEvent(new Event("change"));
    await nextTick();
    expect(live.text()).toBe("新增内容".repeat(30));
    expect(frames.size).toBe(0);
    await live.setProps({ blocks: blocks("新增内容".repeat(31)) });
    expect(live.text()).toBe("新增内容".repeat(31));
  });

  it("pauses the presentation cursor during selection and releases it after selection ends", async () => {
    const wrapper = mountContent("正在阅读");
    await wrapper.setProps({ blocks: blocks("正在阅读" + "后续文字".repeat(30)) });
    const selection = document.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(wrapper.get("p").element);
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await frame(200);
    expect(wrapper.text()).toBe("正在阅读");
    expect(selection.toString()).toBe("正在阅读");
    selection.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await frame(180);
    expect(wrapper.text()).toBe("正在阅读" + "后续文字".repeat(30));
  });

  it("flushes hidden-window content and cancels animation work on unmount", async () => {
    const wrapper = mountContent();
    await wrapper.setProps({ blocks: blocks("文字".repeat(100)) });
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await nextTick();
    expect(wrapper.text()).toBe("文字".repeat(100));
    expect(frames.size).toBe(0);
    hidden.mockRestore();
    await wrapper.setProps({ blocks: blocks("文字".repeat(200)) });
    wrapper.unmount();
    expect(frames.size).toBe(0);
  });
});
