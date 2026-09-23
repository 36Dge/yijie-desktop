import { computed, onScopeDispose, watch } from "vue";
import { createScheduledTaskNativeClient, ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { ImportantUpdate } from "../../api/generated/scheduled-task-ipc.gen";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";

/** Read-only app-wide observation, not a scheduler or a second run state machine. */
export function useScheduledUpdates(
  changed: (item: ImportantUpdate, announce: boolean) => void,
  clear: () => void,
  client = createScheduledTaskNativeClient(),
) {
  const chat = useChatStore(); const permissions = usePermissionStore();
  const scope = computed(() => permissions.isReady && permissions.hasCapability("schedule.read") && permissions.selectedTenantId !== null
    ? `${permissions.selectedTenantId}:${permissions.authorizationRevision}` : null);
  const seen = new Map<string, ImportantUpdate["state"]>();
  let initialized = false; let disposed = false; let epoch = 0; let busy = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(ms: number) {
    clearTimeout(timer);
    if (!disposed && scope.value && chat.context) timer = setTimeout(() => { void refresh(); }, ms);
  }
  async function refresh() {
    if (busy || disposed || !scope.value || !chat.context) return;
    busy = true; const ticket = epoch; const context = chat.context.contextId;
    let delay = 3000;
    try {
      const result = await client.call("schedule_list_important_updates_v1", { schemaVersion: 1, requestId: crypto.randomUUID(), contextId: context, payload: {} });
      if (disposed || epoch !== ticket || chat.context?.contextId !== context) return;
      for (const item of result.data.items) {
        const previous = seen.get(item.run_id);
        if (previous !== item.state) {
          // On open, old completions stay in history; unresolved attention is visible.
          changed(item, item.state !== "pending" && (initialized || item.state === "needs_attention"));
        }
        seen.delete(item.run_id); seen.set(item.run_id, item.state);
      }
      initialized = true;
      // The native feed is bounded. Retain only a bounded in-memory dedup history.
      while (seen.size > 1000) seen.delete(seen.keys().next().value!);
    } catch (error) {
      delay = 30000;
      if (epoch === ticket && error instanceof ScheduledTaskNativeError && ["scope_denied", "permission_denied", "context_invalid", "storage_disabled"].includes(error.code)) {
        clear();
        // No capability or ordinary SQL15: wait for the authority/context watcher.
        delay = -1;
      }
    } finally {
      busy = false;
      if (ticket !== epoch) schedule(0);
      else if (delay >= 0) schedule(delay);
    }
  }
  watch([scope, () => chat.context?.contextId], ([key, context], previous) => {
    epoch++; clearTimeout(timer);
    if (key !== previous?.[0] || !key || !context) { seen.clear(); initialized = false; clear(); }
    if (key && context) void refresh();
  }, { immediate: true, flush: "sync" });
  onScopeDispose(() => { disposed = true; epoch++; clearTimeout(timer); seen.clear(); clear(); });
  return { refresh };
}
