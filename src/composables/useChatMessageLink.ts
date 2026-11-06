import { computed, inject, onBeforeUnmount, ref, watch, type ComputedRef, type InjectionKey } from "vue";
import type { MessageFileReference } from "../domain/message-file-reference";
import type { WebSourceTarget } from "../domain/web-source.generated";
import { sourceHref, webSourceActionsKey } from "./useWebSources";

export type MessageLinkTarget = Omit<WebSourceTarget, "url">;
export const messageFileActionKey: InjectionKey<ComputedRef<((target: MessageLinkTarget, file: MessageFileReference) => void) | undefined>> = Symbol("message-file-action");
export const messageFileWorkspaceKey: InjectionKey<ComputedRef<string | null>> = Symbol("message-file-workspace");
export const messageFileLocationKey: InjectionKey<ComputedRef<((target: MessageLinkTarget, file: MessageFileReference) => Promise<string>) | undefined>> = Symbol("message-file-location");
export const messageLinkTargetKey: InjectionKey<() => MessageLinkTarget | undefined> = Symbol("message-link-target");

export function useChatMessageLink(destination: () => string | null) {
  const scope = inject(messageLinkTargetKey, () => undefined);
  const actions = inject(webSourceActionsKey, null);
  const pending = ref(false);
  const error = ref<string | null>(null);
  const href = computed(() => actions?.openMessageLink && scope() ? sourceHref(destination() ?? "") : undefined);
  let generation = 0;
  watch(() => {
    const target = scope();
    return JSON.stringify([target?.sessionId, target?.turnId, target?.itemId, destination()]);
  }, () => { generation++; pending.value = false; error.value = null; });
  onBeforeUnmount(() => { generation++; });
  async function open() {
    const target = scope();
    const url = href.value;
    if (pending.value || !target || !url || !actions?.openMessageLink) return;
    const current = generation;
    pending.value = true; error.value = null;
    try { await actions.openMessageLink({...target, url}); }
    catch { if (current === generation) error.value = "暂时无法打开链接，请再次点击重试。"; }
    finally { if (current === generation) pending.value = false; }
  }
  return {href, pending, error, open};
}
