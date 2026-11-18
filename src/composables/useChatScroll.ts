import { computed, nextTick, onBeforeUnmount, provide, ref, watch, type InjectionKey, type Ref } from "vue";
import {
  CHAT_BOTTOM_BUTTON_THRESHOLD_PX,
  CHAT_FOLLOW_THRESHOLD_PX,
} from "../domain/chat-ui";

export const holdChatAutoFollowKey: InjectionKey<() => () => void> = Symbol("holdChatAutoFollow");

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

export function useChatScroll(scrollElement: Ref<HTMLElement | null>) {
  const following = ref(true);
  const bottomDistance = ref(0);
  const showBottomButton = computed(() => bottomDistance.value > CHAT_BOTTOM_BUTTON_THRESHOLD_PX);
  let mediaQuery: MediaQueryList | null = null;

  let frame: number | null = null;
  const followHolds = new Set<symbol>();
  let reading = false;
  let navigating = false;
  let previousTop = 0;
  let touchY: number | null = null;
  let submittedAnchor: HTMLElement | null = null;
  let previousMinHeight = "";
  function releaseSubmittedAnchor() {
    if (submittedAnchor) submittedAnchor.style.minHeight = previousMinHeight;
    submittedAnchor = null;
  }
  function sizeSubmittedAnchor() {
    const element = scrollElement.value;
    if (!element || !submittedAnchor || !element.contains(submittedAnchor)) return;
    const style = getComputedStyle(element);
    const inset = (Number.parseFloat(style.scrollPaddingTop) || 0) + (Number.parseFloat(style.scrollPaddingBottom) || 0);
    submittedAnchor.style.minHeight = `${Math.max(0, element.clientHeight - inset)}px`;
  }
  function cancelFrame() { if (frame !== null) cancelAnimationFrame(frame); frame = null; }
  function pauseFollowing() { navigating = false; reading = true; following.value = false; cancelFrame(); }
  provide(holdChatAutoFollowKey, () => {
    const element = scrollElement.value;
    const hold = Symbol();
    followHolds.add(hold);
    cancelFrame();
    return () => {
      if (!followHolds.delete(hold) || followHolds.size || !element || element !== scrollElement.value) return;
      previousTop = element.scrollTop;
      update();
      if (bottomDistance.value > CHAT_FOLLOW_THRESHOLD_PX) pauseFollowing();
    };
  });
  function selectionActive() {
    const selection = document.getSelection();
    return !!selection && !selection.isCollapsed && !!scrollElement.value &&
      (scrollElement.value.contains(selection.anchorNode) || scrollElement.value.contains(selection.focusNode));
  }
  function update(): void {
    const element = scrollElement.value;
    if (!element) return;
    bottomDistance.value = distanceFromBottom(element);
    if (followHolds.size) return;
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
    if (!following.value || followHolds.size) return;
    await nextTick();
    if (!following.value || followHolds.size || selectionActive() || frame !== null) return;
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

  function scrollToAnchor(anchor: HTMLElement, focus = true): void {
    const element = scrollElement.value;
    if (!element || !element.contains(anchor)) return;
    pauseFollowing();
    // scrollIntoView also moves overflow:hidden ancestors, including the app
    // shell. Navigate this conversation alone, converting zoomed screen bounds
    // back to its CSS scroll coordinates and preserving its reading inset.
    const bounds = element.getBoundingClientRect();
    const scale = element.offsetHeight > 0 && bounds.height > 0
      ? bounds.height / element.offsetHeight : 1;
    const padding = Number.parseFloat(getComputedStyle(element).scrollPaddingTop) || 0;
    const margin = Number.parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0;
    const targetTop = element.scrollTop + (anchor.getBoundingClientRect().top - bounds.top) / scale
      - element.clientTop - padding - margin;
    element.scrollTop = Math.max(0, Math.min(targetTop, element.scrollHeight - element.clientHeight));
    previousTop = element.scrollTop;
    bottomDistance.value = distanceFromBottom(element);
    if (focus) anchor.focus({ preventScroll: true });
  }

  function scrollToSubmittedTurn(anchor: HTMLElement): void {
    const element = scrollElement.value;
    if (!element || !element.contains(anchor)) return;
    if (submittedAnchor !== anchor) {
      releaseSubmittedAnchor();
      submittedAnchor = anchor;
      previousMinHeight = anchor.style.minHeight;
    }
    sizeSubmittedAnchor();
    scrollToAnchor(anchor, false);
    reading = false; navigating = false; following.value = true;
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
    releaseSubmittedAnchor();
    cancelFrame(); previousTop = element?.scrollTop ?? 0; reading = false; navigating = false; following.value = true;
    if (!element) return;
    element.addEventListener("chat-content-progress", progress);
    element.addEventListener("wheel", wheel, { passive: true });
    element.addEventListener("keydown", key);
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: true });
    document.addEventListener("selectionchange", selectionChanged);
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { sizeSubmittedAnchor(); progress(); });
    resize?.observe(element);
    onCleanup(() => {
      resize?.disconnect();
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
    releaseSubmittedAnchor();
    mediaQuery = null;
  });

  return {
    following,
    bottomDistance,
    showBottomButton,
    update,
    scrollToBottom,
    scrollToAnchor,
    scrollToSubmittedTurn,
    followNewContent,
    preservePositionWhile,
  };
}
