<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";

defineProps<{ expanded: boolean }>();
</script>

<template>
  <YjIcon class="chat-activity-chevron" :name="expanded ? 'chevronDown' : 'chevronRight'" size="xs" :stroke-width="1.5" />
</template>

<style scoped>
button > .chat-activity-chevron { flex: none; margin-inline-start: auto; color: inherit; opacity: 0; }
button:is(:hover, :focus-visible, [aria-expanded="true"]) > .chat-activity-chevron { opacity: 1; }
@media (hover: none) {
  button > .chat-activity-chevron { opacity: 1; }
}
</style>
