<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

withDefaults(defineProps<{label?: string; active?: boolean; paused?: boolean}>(), {label: "正在思考", active: true, paused: false});

const visible = ref(true);
function updateVisibility() { visible.value = document.visibilityState !== "hidden"; }
onMounted(() => {
  updateVisibility();
  document.addEventListener("visibilitychange", updateVisibility);
});
onBeforeUnmount(() => document.removeEventListener("visibilitychange", updateVisibility));
</script>

<template>
  <span class="chat-thinking" :class="{ 'chat-thinking--active': active, 'chat-thinking--paused': paused || !visible }">{{ label }}</span>
</template>

<style scoped>
.chat-thinking {
  display: inline-block;
  color: inherit;
}
.chat-thinking--active { color: var(--yj-color-text-tertiary); }
@supports (background-clip: text) or (-webkit-background-clip: text) {
  .chat-thinking--active {
    background: linear-gradient(100deg,
      var(--yj-color-text-tertiary) 36%,
      var(--yj-color-chat-thinking-highlight) 48%,
      var(--yj-color-chat-thinking-highlight) 52%,
      var(--yj-color-text-tertiary) 64%) 100% 0 / 300% 100%;
    background-repeat: no-repeat;
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    animation: chat-thinking-sweep var(--yj-motion-chat-thinking) linear infinite;
  }
}
.chat-thinking--paused { animation-play-state: paused; }
@keyframes chat-thinking-sweep {
  0% { background-position: 100% 0; }
  85%, 100% { background-position: 0 0; }
}
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-thinking--active {
    animation: none;
    background: none;
    color: var(--yj-color-text-tertiary);
  }
}
</style>
