import { computed, nextTick, onBeforeUnmount, ref, type Ref } from "vue";
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

  function update(): void {
    const element = scrollElement.value;
    if (!element) return;
    bottomDistance.value = distanceFromBottom(element);
    following.value = bottomDistance.value <= CHAT_FOLLOW_THRESHOLD_PX;
  }

  function scrollToBottom(focus = false): void {
    const element = scrollElement.value;
    if (!element) return;
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
    scrollToBottom();
  }

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
