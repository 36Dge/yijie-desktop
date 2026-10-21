<script setup lang="ts">
import type { ChatSkillChip } from "../../domain/chat-skills";
import ChatComposerMention from "./ChatComposerMention.vue";

defineProps<{ entries: readonly ChatSkillChip[]; disabled?: boolean }>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <ul v-if="entries.length" class="chat-skill-chips" aria-label="本轮使用的技能">
    <li v-for="entry in entries" :key="entry.id" class="chat-skill-chip">
      <ChatComposerMention
        :name="entry.displayName"
        icon="skillOperations"
        :remove-label="`移除技能 ${entry.displayName}`"
        :unavailable-reason="entry.unavailableReason"
        :disabled="disabled"
        @remove="$emit('remove', entry.id)"
      />
    </li>
  </ul>
</template>

<style scoped>
.chat-skill-chips { display: flex; flex: none; gap: var(--yj-space-3); list-style: none; padding: 0; margin: 0; }
.chat-skill-chip { display: flex; flex: none; min-width: 0; max-width: min(100%, var(--yj-layout-connector-chip-max)); }
.chat-skill-chip :deep(.chat-composer-mention) { position: relative; isolation: isolate; }
.chat-skill-chip :deep(.chat-composer-mention::before) { content: ""; position: absolute; inset: calc(-1 * var(--yj-border-width)) calc(-1 * var(--yj-space-1)); z-index: -1; border-radius: var(--yj-radius-full); pointer-events: none; }
.chat-skill-chip :deep(.chat-composer-mention:is(:hover, :focus-visible):not(:disabled)) { color: var(--yj-color-connector-mention); }
.chat-skill-chip :deep(.chat-composer-mention:is(:hover, :focus-visible):not(:disabled)::before) { background: var(--yj-color-chat-skill-hover-bg); }
</style>
