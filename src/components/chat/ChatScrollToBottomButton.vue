<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";
</script>

<template>
  <button class="chat-scroll-to-bottom" type="button" aria-label="滚动到对话底部">
    <YjIcon name="backToBottom" size="md" />
  </button>
</template>

<style scoped>
.chat-scroll-to-bottom {
  display: inline-flex;
  width: var(--yj-control-height-sm);
  height: var(--yj-control-height-sm);
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-chat-composer);
  cursor: pointer;
}
.chat-scroll-to-bottom:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
</style>
