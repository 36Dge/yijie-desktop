<script setup lang="ts">
import type { ChatSkillChip } from "../../domain/chat-skills";
import ChatSkillPill from "./ChatSkillPill.vue";

defineProps<{ entries: readonly ChatSkillChip[]; disabled?: boolean }>();
defineEmits<{ remove: [id: string] }>();
</script>

<template>
  <ul v-if="entries.length" class="chat-skill-chips" aria-label="本轮使用的技能">
    <li v-for="entry in entries" :key="entry.id" class="chat-skill-chip">
      <ChatSkillPill :entry="entry" removable :disabled="disabled" @remove="$emit('remove', $event)" />
    </li>
  </ul>
</template>

<style scoped>
.chat-skill-chips { display: flex; flex: none; gap: var(--yj-space-2); list-style: none; padding: 0; margin: 0; }
.chat-skill-chip { display: flex; flex: none; min-width: 0; max-width: min(100%, var(--yj-layout-connector-chip-max)); }
</style>
