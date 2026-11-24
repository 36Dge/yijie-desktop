import { computed, inject, onBeforeUnmount, ref, shallowRef, watch, type ComputedRef, type InjectionKey } from "vue";
import type { MessageFileReference } from "../domain/message-file-reference";
import type { WebSourceTarget } from "../domain/web-source.generated";
import { sourceHref, webSourceActionsKey } from "./useWebSources";

export type MessageLinkTarget = Omit<WebSourceTarget, "url">;
export const messageFileActionKey: InjectionKey<ComputedRef<((target: MessageLinkTarget, file: MessageFileReference) => void) | undefined>> = Symbol("message-file-action");
export type LocateMessageFile = (target: MessageLinkTarget, file: MessageFileReference) => Promise<string | null>;
export const messageFileLocationKey: InjectionKey<ComputedRef<LocateMessageFile | undefined>> = Symbol("message-file-location");
export const messageLinkTargetKey: InjectionKey<() => MessageLinkTarget | undefined> = Symbol("message-link-target");

/** A syntactic candidate only becomes a link after a scoped Native locate
 * supplies regular-file metadata. Only the confirmed display path is retained. */
export function useMessageFileLocations(target: () => MessageLinkTarget | undefined) {
  const locator = inject(messageFileLocationKey, null);
  const locations = shallowRef<ReadonlyMap<string, string>>(new Map());
  const checked = new Map<string, {settled: boolean; result: Promise<string | null>}>();
  let epoch = 0;
  function clear() { epoch++; checked.clear(); locations.value = new Map(); }
  watch([() => target()?.sessionId, () => target()?.turnId, () => target()?.itemId, () => locator?.value], clear, {flush: "sync"});
  onBeforeUnmount(clear);
  const lookup = computed(() => {
    if (!target()) return undefined;
    const known = locations.value;
    return (file: MessageFileReference) => known.get(file.path);
  });
  function verify(files: readonly MessageFileReference[] | undefined, settled: boolean) {
    const message = target(), locate = locator?.value, current = epoch;
    if (!files?.length || !message || !locate) return;
    for (const file of files) {
      const previous = checked.get(file.path);
      if (previous && (!settled || previous.settled)) continue;
      const read = () => current === epoch ? locate(message, file).catch(() => null) : null;
      // A streaming preview may precede the persisted final message. Recheck a
      // live miss once after settlement, even if its request is still in flight.
      const result = previous ? previous.result.then(path => path ?? read()) : Promise.resolve(read());
      checked.set(file.path, {settled, result});
      void result.then(path => {
        if (path && current === epoch && !locations.value.has(file.path)) {
          locations.value = new Map(locations.value).set(file.path, path);
        }
      });
    }
  }
  return {lookup, verify};
}

export function useChatMessageLink(destination: () => string | null, userUrl = () => false) {
  const scope = inject(messageLinkTargetKey, () => undefined);
  const actions = inject(webSourceActionsKey, null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  const opener = computed(() => userUrl() ? actions?.openUserMessageLink : actions?.openMessageLink);
  const href = computed(() => opener.value && scope() ? sourceHref(destination() ?? "") : undefined);
  let generation = 0;
  watch(() => {
    const target = scope();
    return JSON.stringify([target?.sessionId, target?.turnId, target?.itemId, destination(), userUrl()]);
  }, () => { generation++; pending.value = false; error.value = null; });
  onBeforeUnmount(() => { generation++; });
  async function open() {
    const target = scope();
    const url = href.value;
    if (pending.value || !target || !url || !opener.value) return;
    const current = generation;
    pending.value = true; error.value = null;
    try { await opener.value({...target, url}); }
    catch { if (current === generation) error.value = "暂时无法打开链接，请再次点击重试。"; }
    finally { if (current === generation) pending.value = false; }
  }
  return {href, pending, error, open};
}
