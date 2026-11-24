import { shallowReactive, type InjectionKey } from "vue";

/** Owned by the mounted conversation surface, discarded on unmount/context change.
 * Keys include thread/turn/group identity. No DB, localStorage or execution state. */
export function createChatTracePresentationStore() {
  const choices = shallowReactive(new Map<string, boolean>());
  const scrollOffsets = new Map<string, number>();
  return {
    has: (key: string) => choices.has(key),
    get: (key: string, fallback: boolean) => choices.get(key) ?? fallback,
    set: (key: string, value: boolean) => { choices.set(key, value); },
    scrollTop: (key: string) => scrollOffsets.get(key) ?? 0,
    setScrollTop: (key: string, top: number) => {
      if (top > 0) scrollOffsets.set(key, top);
      else scrollOffsets.delete(key);
    },
    clear: () => { choices.clear(); scrollOffsets.clear(); },
  };
}
export const chatTracePresentationKey: InjectionKey<ReturnType<typeof createChatTracePresentationStore>> = Symbol("chat-trace-presentation");
