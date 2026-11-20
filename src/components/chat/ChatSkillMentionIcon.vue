<script setup lang="ts">
import { computed } from "vue";
import type { SentChatSkill } from "../../domain/chat-skills";
import { skillCardArtwork } from "../../icons/skill-artwork";

const props = defineProps<{ entry: SentChatSkill }>();
const artwork = computed(() => skillCardArtwork({ id: props.entry.id, category: props.entry.category ?? "personal" }));
</script>

<template>
  <img class="chat-skill-mention-icon" :src="artwork" alt="" aria-hidden="true" draggable="false" />
</template>

<style scoped>
.chat-skill-mention-icon {
  display: block;
  flex: none;
  width: var(--yj-space-5);
  height: var(--yj-space-5);
  border-radius: var(--yj-radius-xs);
  object-fit: contain;
}
</style>
