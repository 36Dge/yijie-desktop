<script setup lang="ts">
import type { ConnectorChipView } from "../../domain/connector-ui";
import ConnectorIcon from "../connectors/ConnectorIcon.vue";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{ entries: readonly ConnectorChipView[]; disabled?: boolean }>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <ul v-if="entries.length" class="chat-connector-chips" aria-label="本轮使用的连接器">
    <li v-for="entry in entries" :key="entry.id" class="chat-connector-chip" :class="{ 'chat-connector-chip--unavailable': entry.unavailableReason }">
      <ConnectorIcon :asset-id="entry.iconAssetId" size="sm" />
      <span class="chat-connector-chip__copy" :title="entry.unavailableReason ? `${entry.name}：${entry.unavailableReason}` : entry.name"><span>{{ entry.name }}</span><span v-if="entry.unavailableReason" class="chat-connector-chip__reason">{{ entry.unavailableReason }}</span></span>
      <button type="button" :aria-label="`移除 ${entry.name}`" :title="`移除 ${entry.name}`" :disabled="disabled" @click="$emit('remove', entry.id)"><YjIcon name="dismiss" size="xs" /></button>
    </li>
  </ul>
</template>

<style scoped>
.chat-connector-chips { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); list-style: none; margin: 0; padding: var(--yj-space-3) var(--yj-space-4) 0; max-height: var(--yj-layout-connector-chip-list-max); overflow-y: auto; }
.chat-connector-chip { display: inline-flex; min-width: 0; max-width: min(100%, var(--yj-layout-connector-chip-max)); align-items: center; gap: var(--yj-space-2); padding: var(--yj-space-1) var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); }
.chat-connector-chip--unavailable { border-color: var(--yj-color-semantic-warning-ink); }
.chat-connector-chip__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; font-size: var(--yj-font-size-body); }
.chat-connector-chip__copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-connector-chip__reason { font-size: var(--yj-font-size-caption); color: var(--yj-color-semantic-warning-ink); }
.chat-connector-chip button { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--yj-space-6); height: var(--yj-space-6); padding: 0; border: 0; border-radius: var(--yj-radius-sm); color: var(--yj-color-text-secondary); background: transparent; }
.chat-connector-chip button:hover:not(:disabled) { background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.chat-connector-chip button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-connector-chip button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-connector-chip button :deep(.yj-icon) { color: inherit; }
</style>
