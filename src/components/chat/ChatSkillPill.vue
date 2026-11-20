<script setup lang="ts">
import type { SentChatSkill } from "../../domain/chat-skills";
import ChatSkillMentionIcon from "./ChatSkillMentionIcon.vue";

defineProps<{ entry: SentChatSkill }>();
</script>

<template>
  <span class="chat-skill-pill">
    <ChatSkillMentionIcon :entry="entry" />
    <span class="chat-skill-pill__name">{{ entry.displayName }}</span>
  </span>
</template>

<style scoped>
.chat-skill-pill {
  display: inline-flex;
  max-width: calc(100% - var(--yj-space-2));
  align-items: baseline;
  gap: var(--yj-space-1);
}
.chat-skill-pill > .chat-skill-mention-icon { align-self: center; }
.chat-skill-pill__name {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--yj-color-chat-skill-mention);
  font-weight: var(--yj-font-weight-medium);
}
</style>
