<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

const visible = ref(true);
function updateVisibility() { visible.value = document.visibilityState !== "hidden"; }
onMounted(() => {
  updateVisibility();
  document.addEventListener("visibilitychange", updateVisibility);
});
onBeforeUnmount(() => document.removeEventListener("visibilitychange", updateVisibility));
</script>

<template>
  <span class="chat-thinking" :class="{ 'chat-thinking--paused': !visible }">正在思考</span>
</template>

<style scoped>
.chat-thinking {
  display: inline-block;
  color: var(--yj-color-text-tertiary);
}
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .chat-thinking {
    background: linear-gradient(100deg,
      var(--yj-color-text-tertiary) 35%,
      var(--yj-color-text-primary) 50%,
      var(--yj-color-text-tertiary) 65%) 100% 0 / 250% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: chat-thinking-sweep var(--yj-motion-chat-thinking) linear infinite;
  }
}
.chat-thinking--paused { animation-play-state: paused; }
@keyframes chat-thinking-sweep {
  to { background-position: 0 0; }
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-thinking {
    animation: none;
    background: none;
    color: var(--yj-color-text-tertiary);
  }
}
</style>
