<script setup lang="ts">
import type { ConnectorChipView } from "../../domain/connector-ui";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{ entries: readonly ConnectorChipView[]; disabled?: boolean }>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <ul v-if="entries.length" class="chat-connector-chips" aria-label="本轮使用的连接器">
    <li v-for="entry in entries" :key="entry.id" class="chat-connector-chip" :class="{ 'chat-connector-chip--unavailable': entry.unavailableReason }">
      <button type="button" :aria-label="`移除 ${entry.name}`" :title="entry.unavailableReason ? `${entry.name}：${entry.unavailableReason}；点击移除` : `点击移除 ${entry.name}`" :disabled="disabled" @click="$emit('remove', entry.id)">
        <span class="chat-connector-chip__icon"><YjIcon name="connector" size="sm" /><YjIcon name="dismiss" size="sm" /></span>
        <span class="chat-connector-chip__copy"><span>{{ entry.name }}</span><span v-if="entry.unavailableReason" class="chat-connector-chip__reason">{{ entry.unavailableReason }}</span></span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.chat-connector-chips { display: flex; flex-wrap: wrap; gap: var(--yj-space-2) var(--yj-space-3); list-style: none; margin: 0; padding: 0; max-height: var(--yj-layout-connector-chip-list-max); overflow-y: auto; }
.chat-connector-chip { display: inline-flex; min-width: 0; max-width: min(100%, var(--yj-layout-connector-chip-max)); }
.chat-connector-chip__copy { display: flex; min-width: 0; flex: 1; flex-direction: column; font-size: var(--yj-font-size-body); }
.chat-connector-chip__copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-connector-chip__reason { font-size: var(--yj-font-size-caption); color: var(--yj-color-semantic-warning-ink); }
.chat-connector-chip button { display: inline-flex; min-width: 0; align-items: flex-start; gap: var(--yj-space-1); padding: 0; border: 0; border-radius: var(--yj-radius-sm); color: var(--yj-color-connector-mention); background: transparent; font: inherit; line-height: var(--yj-line-height-body); cursor: pointer; }
.chat-connector-chip__icon { display: inline-grid; flex: none; align-items: center; height: var(--yj-line-height-body); }
.chat-connector-chip__icon > * { grid-area: 1 / 1; }
.chat-connector-chip__icon > :last-child { visibility: hidden; }
.chat-connector-chip button:is(:hover, :focus-visible):not(:disabled) .chat-connector-chip__icon > :first-child { visibility: hidden; }
.chat-connector-chip button:is(:hover, :focus-visible):not(:disabled) .chat-connector-chip__icon > :last-child { visibility: visible; }
.chat-connector-chip button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-connector-chip button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-connector-chip button :deep(.yj-icon) { color: inherit; }
</style>
