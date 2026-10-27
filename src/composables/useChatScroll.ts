import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  CHAT_BOTTOM_BUTTON_THRESHOLD_PX,
  CHAT_FOLLOW_THRESHOLD_PX,
} from "../domain/chat-ui";

function distanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
}

export function useChatScroll(
  scrollElement: Ref<HTMLElement | null>,
  contentElement?: Ref<HTMLElement | null>,
  canFollow: () => boolean = () => true,
) {
  const following = ref(true);
  const bottomDistance = ref(0);
  const showBottomButton = computed(() => bottomDistance.value > CHAT_BOTTOM_BUTTON_THRESHOLD_PX);
  let mediaQuery: MediaQueryList | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;

  function update(): void {
    const element = scrollElement.value;
    if (!element) return;
    bottomDistance.value = distanceFromBottom(element);
    following.value = bottomDistance.value <= CHAT_FOLLOW_THRESHOLD_PX;
  }

  function alignBottom(focus: boolean, automatic: boolean): void {
    const element = scrollElement.value;
    if (!element) return;
    mediaQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
    if (typeof element.scrollTo === "function") {
      element.scrollTo({
        top: element.scrollHeight,
        behavior: automatic || mediaQuery.matches ? "auto" : "smooth",
      });
    } else {
      element.scrollTop = element.scrollHeight;
    }
    bottomDistance.value = 0;
    following.value = true;
    if (focus) element.focus({ preventScroll: true });
  }

  function scrollToBottom(focus = false): void {
    alignBottom(focus, false);
  }

  async function followNewContent(): Promise<void> {
    if (!following.value) return;
    await nextTick();
    // User scrolling or selection can start while Vue is committing this frame.
    const selection = document.getSelection();
    if (disposed || !following.value || !canFollow() ||
      (selection?.isCollapsed === false &&
        (scrollElement.value?.contains(selection.anchorNode) || scrollElement.value?.contains(selection.focusNode)))) return;
    // Repeated smooth-scroll requests restart browser easing on every text delta.
    alignBottom(false, true);
  }

  if (contentElement) watch(contentElement, element => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(() => { void followNewContent(); });
    resizeObserver.observe(element);
  }, { immediate: true, flush: "post" });

  async function preservePositionWhile(action: () => Promise<void>): Promise<void> {
    const element = scrollElement.value;
    if (!element) return action();
    const beforeHeight = element.scrollHeight;
    const beforeTop = element.scrollTop;
    await action();
    await nextTick();
    element.scrollTop = beforeTop + (element.scrollHeight - beforeHeight);
    update();
  }

  onBeforeUnmount(() => {
    disposed = true;
    resizeObserver?.disconnect();
    mediaQuery = null;
  });

  return {
    following,
    bottomDistance,
    showBottomButton,
    update,
    scrollToBottom,
    followNewContent,
    preservePositionWhile,
  };
}
