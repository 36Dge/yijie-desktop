<script setup lang="ts">
import type { SentChatSkill } from "../../domain/chat-skills";
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{ entry: SentChatSkill }>();
</script>

<template>
  <span class="chat-skill-pill">
    <YjIcon name="skillMention" size="sm" />
    <span class="chat-skill-pill__name">{{ entry.displayName }}</span>
  </span>
</template>

<style scoped>
.chat-skill-pill {
  display: inline-flex;
  max-width: calc(100% - var(--yj-space-2));
  align-items: baseline;
  gap: var(--yj-space-1);
  color: var(--yj-color-semantic-success-ink);
  font-weight: var(--yj-font-weight-medium);
}
.chat-skill-pill :deep(.yj-icon) { align-self: center; color: inherit; }
.chat-skill-pill__name { min-width: 0; overflow-wrap: anywhere; }
</style>
