// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import ChatThinkingIndicator from "./ChatThinkingIndicator.vue";

afterEach(() => vi.restoreAllMocks());
it("pauses when hidden and removes the visibility listener on unmount", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const remove = vi.spyOn(document, "removeEventListener");
  const wrapper = mount(ChatThinkingIndicator);
  expect(wrapper.text()).toBe("正在思考");
  expect(wrapper.classes()).not.toContain("chat-thinking--paused");
  visibility.mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await nextTick();
  expect(wrapper.classes()).toContain("chat-thinking--paused");
  wrapper.unmount();
  expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});
it("provides static reduced-motion and forced-color fallbacks for both effects", () => {
  for (const file of ["ChatThinkingIndicator.vue", "ChatStreamText.vue"]) {
    const source = readFileSync(`src/components/chat/${file}`, "utf8");
    expect(source).toContain("(prefers-reduced-motion: reduce)");
    expect(source).toContain("(forced-colors: active)");
    expect(source).toContain("animation: none");
  }
});
