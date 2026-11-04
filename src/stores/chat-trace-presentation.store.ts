import { shallowReactive, type InjectionKey } from "vue";

/** Owned by the mounted conversation surface, discarded on unmount/context change.
 * Keys include thread/turn/group identity. No DB, localStorage or execution state. */
export function createChatTracePresentationStore() {
  const choices = shallowReactive(new Map<string, boolean>());
  return {
    has: (key: string) => choices.has(key),
    get: (key: string, fallback: boolean) => choices.get(key) ?? fallback,
    set: (key: string, value: boolean) => { choices.set(key, value); },
    clear: () => choices.clear(),
  };
}
export const chatTracePresentationKey: InjectionKey<ReturnType<typeof createChatTracePresentationStore>> = Symbol("chat-trace-presentation");
