// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import ChatCopyAction from "./ChatCopyAction.vue";

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function adapter(writeText: ChatClipboardAdapter["writeText"]): ChatClipboardAdapter {
  return Object.freeze({ writeText });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ChatCopyAction", () => {
  it.each([
    ["text" as const, "  可复制文本\n第二行  ", "复制文本", "文本已复制。"],
    ["code" as const, "const value = 1;\n", "复制代码", "代码已复制。"],
  ])("copies exact %s content and announces the real success", async (
    kind,
    text,
    label,
    announcement,
  ) => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    const wrapper = mount(ChatCopyAction, {
      attachTo: document.body,
      props: { adapter: adapter(writeText), text, kind },
    });

    const button = wrapper.get("button");
    await button.trigger("click");
    await flushPromises();

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(text);
    expect(button.attributes("aria-label")).toBe(label);
    expect(wrapper.get("[role='status']").text()).toBe(announcement);
    expect(wrapper.get(".chat-copy-action__feedback").text()).toBe("已复制");
    expect(wrapper.classes()).toContain("chat-copy-action--success");
  });

  it("announces rejection without exposing the adapter error and permits a retry", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("private native clipboard detail"))
      .mockResolvedValueOnce();
    const wrapper = mount(ChatCopyAction, {
      attachTo: document.body,
      props: { adapter: adapter(writeText), text: "安全正文" },
    });

    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.get("[role='status']").text()).toBe("复制失败，请重试。");
    expect(wrapper.text()).not.toContain("private native clipboard detail");
    expect(wrapper.classes()).toContain("chat-copy-action--error");

    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[role='status']").text()).toBe("文本已复制。");
    expect(wrapper.classes()).toContain("chat-copy-action--success");
  });

  it("guards duplicate pending writes and ignores completion for replaced content", async () => {
    const first = deferred();
    const writeText = vi.fn<(_: string) => Promise<void>>().mockReturnValue(first.promise);
    const firstAdapter = adapter(writeText);
    const wrapper = mount(ChatCopyAction, {
      props: { adapter: firstAdapter, text: "旧正文" },
    });

    await wrapper.get("button").trigger("click");
    await wrapper.get("button").trigger("click");
    expect(writeText).toHaveBeenCalledOnce();
    expect(wrapper.get("button").attributes("aria-busy")).toBe("true");

    await wrapper.setProps({ text: "新正文" });
    first.resolve();
    await flushPromises();
    expect(wrapper.get("[role='status']").text()).toBe("");
    expect(wrapper.classes()).toContain("chat-copy-action--idle");
  });

  it("keeps focus, selected text, and source markup unchanged on success and rejection", async () => {
    const source = document.createElement("p");
    source.className = "copy-source";
    source.textContent = "保持选择的正文";
    document.body.append(source);
    const originalMarkup = source.outerHTML;
    const textNode = source.firstChild;
    if (textNode === null) throw new Error("fixture_missing_text_node");
    const range = document.createRange();
    range.setStart(textNode, 2);
    range.setEnd(textNode, 6);
    const selection = window.getSelection();
    if (selection === null) throw new Error("fixture_missing_selection");
    selection.removeAllRanges();
    selection.addRange(range);

    const writeText = vi.fn<(_: string) => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("rejected"));
    const wrapper = mount(ChatCopyAction, {
      attachTo: document.body,
      props: { adapter: adapter(writeText), text: source.textContent },
    });
    const button = wrapper.get("button");
    (button.element as HTMLButtonElement).focus();
    const selectedText = selection.toString();
    const anchorNode = selection.anchorNode;
    const anchorOffset = selection.anchorOffset;
    const focusNode = selection.focusNode;
    const focusOffset = selection.focusOffset;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await button.trigger("pointerdown");
      await button.trigger("mousedown");
      await button.trigger("click");
      await flushPromises();
      expect(document.activeElement).toBe(button.element);
      expect(selection.toString()).toBe(selectedText);
      expect(selection.anchorNode).toBe(anchorNode);
      expect(selection.anchorOffset).toBe(anchorOffset);
      expect(selection.focusNode).toBe(focusNode);
      expect(selection.focusOffset).toBe(focusOffset);
      expect(source.outerHTML).toBe(originalMarkup);
    }
  });

  it("is keyboard-operable, closed for empty text, and accessible", async () => {
    const writeText = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    const wrapper = mount(ChatCopyAction, {
      attachTo: document.body,
      props: { adapter: adapter(writeText), text: "键盘正文" },
    });
    const button = wrapper.get("button");
    (button.element as HTMLButtonElement).focus();
    await button.trigger("keydown", { key: "Enter" });
    await button.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button.element);
    expect((await axe.run(wrapper.element)).violations).toEqual([]);

    await wrapper.setProps({ text: "" });
    expect(button.attributes("aria-disabled")).toBe("true");
    await button.trigger("click");
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("contains no native authority, selection mutation, or executable content path", () => {
    const source = readFileSync("src/components/chat/ChatCopyAction.vue", "utf8");
    expect(source).not.toMatch(/navigator|@tauri-apps|invoke\(|execCommand|window\.|getSelection|removeAllRanges|innerHTML|v-html/i);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).toContain("ChatClipboardAdapter");
    expect(source).toContain('aria-live="polite"');
  });
});
