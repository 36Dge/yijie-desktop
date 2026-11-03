import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  CHAT_BOTTOM_BUTTON_THRESHOLD_PX,
  CHAT_FOLLOW_THRESHOLD_PX,
} from "../domain/chat-ui";

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

export function useChatScroll(scrollElement: Ref<HTMLElement | null>) {
  const following = ref(true);
  const bottomDistance = ref(0);
  const showBottomButton = computed(() => bottomDistance.value > CHAT_BOTTOM_BUTTON_THRESHOLD_PX);
  let mediaQuery: MediaQueryList | null = null;

  let frame: number | null = null;
  let reading = false;
  let navigating = false;
  let previousTop = 0;
  let touchY: number | null = null;
  function cancelFrame() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  function pauseFollowing() { navigating = false; reading = true; following.value = false; cancelFrame(); }
  function selectionActive() {
    const selection = document.getSelection();
    return !!selection && !selection.isCollapsed && !!scrollElement.value &&
      (scrollElement.value.contains(selection.anchorNode) || scrollElement.value.contains(selection.focusNode));
  }
  function update(): void {
    const element = scrollElement.value;
    if (!element) return;
    bottomDistance.value = distanceFromBottom(element);
    const moved = Math.abs(element.scrollTop - previousTop) > 0.5;
    if (element.scrollTop < previousTop - 0.5) { reading = true; navigating = false; }
    previousTop = element.scrollTop;
    if (bottomDistance.value <= 1) { reading = false; navigating = false; }
    // Growing content increases the distance without a reader scroll. Preserve
    // the existing follow intent until the scheduled layout frame catches up.
    if (navigating) { following.value = true; return; }
    if (moved || reading || bottomDistance.value <= CHAT_FOLLOW_THRESHOLD_PX) {
      following.value = !reading && bottomDistance.value <= CHAT_FOLLOW_THRESHOLD_PX;
    }
  }

  function scrollToBottom(focus = false): void {
    const element = scrollElement.value;
    if (!element) return;
    cancelFrame(); reading = false; navigating = true; previousTop = element.scrollTop;
    mediaQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    if (typeof element.scrollTo === "function") {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: mediaQuery.matches ? "auto" : "smooth",
      });
    } else {
      element.scrollTop = element.scrollHeight;
    }
    bottomDistance.value = 0;
    following.value = true;
    if (focus) element.focus({ preventScroll: true });
  }

  async function followNewContent(): Promise<void> {
    if (!following.value) return;
    await nextTick();
    if (!following.value || selectionActive() || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const element = scrollElement.value;
      if (!element || !following.value || selectionActive()) return;
      // Automatic follow tracks layout directly. Only the explicit bottom
      // button starts a smooth navigation animation.
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      navigating = false; previousTop = element.scrollTop;
      bottomDistance.value = distanceFromBottom(element);
    });
  }

  function scrollToAnchor(anchor: HTMLElement): void {
    const element = scrollElement.value;
    if (!element || !element.contains(anchor)) return;
    pauseFollowing();
    // Native scrolling accounts for CSS zoom and the scroller's scroll padding.
    anchor.scrollIntoView({ block: "start", behavior: "instant" });
    previousTop = element.scrollTop;
    bottomDistance.value = distanceFromBottom(element);
    anchor.focus({ preventScroll: true });
  }

  async function preservePositionWhile(action: () => Promise<void>): Promise<void> {
    const element = scrollElement.value;
    if (!element) return action();
    cancelFrame(); navigating = false;
    const beforeHeight = element.scrollHeight;
    const beforeTop = element.scrollTop;
    await action();
    await nextTick();
    element.scrollTop = beforeTop + (element.scrollHeight - beforeHeight);
    update();
  }

  function wheel(event: WheelEvent) { if (event.deltaY < 0) pauseFollowing(); }
  function key(event: KeyboardEvent) { if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) pauseFollowing(); }
  function touchStart(event: TouchEvent) { touchY = event.touches[0]?.clientY ?? null; }
  function touchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY;
    if (y !== undefined && touchY !== null && y > touchY) pauseFollowing();
    touchY = y ?? null;
  }
  function progress() { void followNewContent(); }
  function selectionChanged() { if (selectionActive()) cancelFrame(); else progress(); }
  watch(scrollElement, (element, old, onCleanup) => {
    if (element === old) return;
    cancelFrame(); previousTop = element?.scrollTop ?? 0; reading = false; navigating = false; following.value = true;
    if (!element) return;
    element.addEventListener("chat-content-progress", progress);
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("keydown", key);
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: true });
    document.addEventListener("selectionchange", selectionChanged);
    onCleanup(() => {
      element.removeEventListener("chat-content-progress", progress);
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("keydown", key);
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      document.removeEventListener("selectionchange", selectionChanged);
    });
  }, { flush: "post" });

  onBeforeUnmount(() => {
    cancelFrame();
    mediaQuery = null;
  });

  return {
    following,
    bottomDistance,
    showBottomButton,
    update,
    scrollToBottom,
    scrollToAnchor,
    followNewContent,
    preservePositionWhile,
  };
}
