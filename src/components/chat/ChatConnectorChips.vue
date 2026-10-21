<script setup lang="ts">
import type { ConnectorChipView } from "../../domain/connector-ui";
import ChatComposerMention from "./ChatComposerMention.vue";

defineProps<{ entries: readonly ConnectorChipView[]; disabled?: boolean }>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <ul v-if="entries.length" class="chat-connector-chips" aria-label="本轮使用的连接器">
    <li v-for="entry in entries" :key="entry.id" class="chat-connector-chip" :class="{ 'chat-connector-chip--unavailable': entry.unavailableReason }">
      <ChatComposerMention
        :name="entry.name"
        icon="connector"
        :remove-label="`移除 ${entry.name}`"
        :unavailable-reason="entry.unavailableReason"
        :disabled="disabled"
        @remove="$emit('remove', entry.id)"
      />
    </li>
  </ul>
</template>

<style scoped>
.chat-connector-chips { display: flex; flex-wrap: wrap; gap: var(--yj-space-2) var(--yj-space-3); list-style: none; margin: 0; padding: 0; max-height: var(--yj-layout-connector-chip-list-max); overflow-y: auto; }
.chat-connector-chip { display: inline-flex; min-width: 0; max-width: min(100%, var(--yj-layout-connector-chip-max)); }
</style>
