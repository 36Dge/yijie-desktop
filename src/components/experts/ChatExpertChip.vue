<script setup lang="ts">
import type { ExpertDisplay } from "../../domain/experts.generated";
import { isYjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ expert: ExpertDisplay; disabled?: boolean; pending?: boolean }>();
const emit = defineEmits<{ details: []; remove: [] }>();
</script>
<template>
  <div class="chat-expert-chip" :aria-busy="pending">
    <button type="button" class="yj-control yj-control--pill chat-expert-chip__details" :title="`${expert.displayName} · ${expert.subtitle} · ${expert.version}`" :aria-label="`查看已选专家 ${expert.displayName}`" @click="emit('details')">
      <YjIcon :name="isYjIconName(expert.iconKey) ? expert.iconKey : 'skillOperations'" size="sm" />
      <span>{{ expert.displayName }}</span><span class="chat-expert-chip__subtitle">{{ expert.subtitle }}</span><span v-if="pending">处理中</span>
    </button>
    <button type="button" class="yj-control yj-control--pill chat-expert-chip__remove" :disabled="disabled || pending" aria-label="移除专家" title="移除专家，已有聊天保留" @click="emit('remove')"><YjIcon name="dismiss" size="xs" /></button>
  </div>
</template>
<style scoped>
.chat-expert-chip { display: inline-flex; align-items: center; min-width: 0; max-width: 100%; border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-full); }
.chat-expert-chip > button {
  -webkit-appearance: none;
  appearance: none;
  border: 0;
  box-shadow: none;
  color: var(--yj-color-text-primary);
  background: transparent;
  cursor: pointer;
  transition: background var(--yj-motion-fast) var(--yj-ease-standard);
}
.chat-expert-chip > button:hover:not(:disabled) { background: var(--yj-color-control-hover); }
.chat-expert-chip > button:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.chat-expert-chip > button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.chat-expert-chip > button:disabled { color: var(--yj-color-text-disabled); cursor: default; opacity: 1; }
.chat-expert-chip__details { min-width: 0; }
.chat-expert-chip__details span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: calc(var(--yj-space-16) * 3); }
.chat-expert-chip__subtitle { flex-shrink: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-expert-chip__remove { flex-shrink: 0; }
@media (hover: hover) { .chat-expert-chip__remove { opacity: 0; } .chat-expert-chip:hover .chat-expert-chip__remove, .chat-expert-chip:focus-within .chat-expert-chip__remove { opacity: 1; } }
</style>
