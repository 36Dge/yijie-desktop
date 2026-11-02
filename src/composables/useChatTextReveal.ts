import { computed, onBeforeUnmount, onMounted, shallowRef, watch, type InjectionKey, type Ref } from "vue";
import { createChatTextReveal, type TextRevealFrame } from "../domain/chat-text-reveal";
import { browserFrameProjectionScheduler } from "../domain/frame-batched-projection";

export interface ChatTextRevealContext { readonly frame: Readonly<Ref<TextRevealFrame>> }
export const chatTextRevealKey: InjectionKey<ChatTextRevealContext> = Symbol("chat-text-reveal");

export function useChatTextReveal(text: () => string, live: () => boolean, animate: () => boolean, root: Ref<HTMLElement | null>): ChatTextRevealContext {
  const frame = shallowRef<TextRevealFrame>({ cursor: 0, ranges: [] });
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce), (forced-colors: active)");
  let hidden = document.visibilityState === "hidden";
  let lastCursor = 0;
  const reveal = createChatTextReveal(browserFrameProjectionScheduler(), () => performance.now(), value => {
    frame.value = value;
    if (lastCursor !== value.cursor) {
      lastCursor = value.cursor;
      // The existing scroll owner follows the actual rendered content, including
      // frames between transport events. This never changes execution state.
      root.value?.dispatchEvent(new CustomEvent("chat-content-progress", { bubbles: true }));
    }
  });
  function sync() { reveal.update(text(), live(), animate() && !motion?.matches && !hidden); }
  function selectionChanged() {
    const selection = document.getSelection();
    const inside = selection && !selection.isCollapsed &&
      (root.value?.contains(selection.anchorNode) || root.value?.contains(selection.focusNode));
    reveal.pause(Boolean(inside));
  }
  function visibilityChanged() { hidden = document.visibilityState === "hidden"; sync(); }
  watch([text, live, animate], sync, { immediate: true, flush: "sync" });
  onMounted(() => {
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    motion?.addEventListener("change", sync);
  });
  onBeforeUnmount(() => {
    reveal.dispose();
    document.removeEventListener("selectionchange", selectionChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
    motion?.removeEventListener("change", sync);
  });
  return { frame: computed(() => frame.value) };
}
