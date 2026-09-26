<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { useNotification } from "naive-ui";
import { onChatHistoryChanged } from "../../api/chat-history-events";
import { cleanupNotice, localHistoryDeletionFinished } from "../../domain/chat-ui";
import { useChatStore } from "../../stores/chat.store";

const store = useChatStore();
const notifications = useNotification();
const announced = new Set<string>();
let disposed = false;
let stop: (() => void) | undefined;
let historyChanged = false;
async function refreshHistory(): Promise<void> {
  if (!historyChanged || !store.hasAction("read_sessions")
    || ["binding", "loading"].includes(store.phase)) return;
  historyChanged = false;
  await store.reloadSessions().catch(() => { historyChanged = true; });
}
watch(() => [store.phase, store.context?.contextId], () => { void refreshHistory(); });
onMounted(async () => {
  const unlisten = await onChatHistoryChanged(() => {
    historyChanged = true;
    void refreshHistory();
  }).catch(() => undefined);
  if (disposed) unlisten?.();
  else stop = unlisten;
});
onBeforeUnmount(() => { disposed = true; stop?.(); });
watch(() => store.cleanupStatus, (status) => {
  if (!status || !localHistoryDeletionFinished(status) || announced.has(status.operationId)) return;
  const notice = cleanupNotice(status)!;
  announced.add(status.operationId);
  // Keep the qualification visible after navigation clears the deleted selection.
  notifications.warning({ title: notice.title, content: notice.detail, duration: 0, closable: true });
}, { flush: "sync" });
</script>

<template><span hidden aria-hidden="true" /></template>
