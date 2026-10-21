<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ selected: boolean }>();
</script>
<template>
  <span class="chat-resource-check" aria-hidden="true"><YjIcon v-if="selected" name="checkmark" size="xs" /></span>
</template>
<style scoped>
.chat-resource-check { display: grid; place-items: center; flex: none; width: var(--yj-space-4); height: var(--yj-space-4); margin-right: var(--yj-space-1); }
.chat-resource-check :deep(.yj-icon) { color: var(--yj-color-connector-composer-mention); }
</style>
