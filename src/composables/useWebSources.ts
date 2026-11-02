import { inject, onBeforeUnmount, provide, ref, watch, type InjectionKey } from "vue";
import { webSourceClient } from "../api/chat-web-source-client";
import type { WebSourceTarget } from "../domain/web-source.generated";
import type { ConversationTimelineItemViewModel } from "../domain/conversation-timeline";

export type WebSourceActions = {
  icon(target: WebSourceTarget): Promise<string | null>;
  open(target: WebSourceTarget): Promise<void>;
  openMessageLink?(target: WebSourceTarget): Promise<void>;
};
export const webSourceActionsKey: InjectionKey<WebSourceActions> = Symbol("web-source-actions");
export function provideWebSourceActions(contextId: () => string | undefined) {
  async function run(action: "icon" | "open" | "open_message_link", target: WebSourceTarget) {
    const id = contextId();
    if (!id) throw new Error("web_source_context_unavailable");
    return webSourceClient(id, {action, target});
  }
  provide(webSourceActionsKey, {
    icon: async target => (await run("icon", target)).icon,
    open: async target => { await run("open", target); },
    openMessageLink: async target => { await run("open_message_link", target); },
  });
}

export function sourceHref(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? raw : undefined;
  } catch { return undefined; }
}
export function sourceInitial(raw: string): string {
  try { return new URL(raw).hostname.replace(/^www\./, "").charAt(0).toUpperCase() || "W"; }
  catch { return "W"; }
}
export function useWebSources(item: () => ConversationTimelineItemViewModel, visible: () => boolean) {
  const actions = inject(webSourceActionsKey, null);
  const icons = ref<Record<string, string | null>>({});
  const openError = ref<string | null>(null);
  let generation = 0;
  const pending = new Set<string>();
  function target(url: string): WebSourceTarget {
    const record = item();
    return {sessionId: record.threadId, turnId: record.turnId, itemId: record.itemId, url};
  }
  watch(() => item().identity, () => { generation++; icons.value = {}; pending.clear(); openError.value = null; });
  watch([visible, () => item().webSearch?.sources], () => {
    if (!visible() || !actions) return;
    const current = generation;
    for (const source of item().webSearch?.sources ?? []) {
      if (!sourceHref(source.url) || source.url in icons.value || pending.has(source.url)) continue;
      pending.add(source.url);
      void actions.icon(target(source.url)).catch(() => null).then(icon => {
        if (current !== generation) return;
        icons.value = {...icons.value, [source.url]: icon}; pending.delete(source.url);
      });
    }
  }, {immediate: true});
  onBeforeUnmount(() => { generation++; });
  async function open(url: string) {
    openError.value = null;
    const current = generation;
    try {
      if (!actions || !sourceHref(url)) throw new Error("unavailable");
      await actions.open(target(url));
    } catch {
      if (generation === current) openError.value = "暂时无法打开网页，请再次点击重试。";
    }
  }
  return {icons, open, openError};
}
