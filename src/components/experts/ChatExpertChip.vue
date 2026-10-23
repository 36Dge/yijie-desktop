<script setup lang="ts">
import type { ExpertDisplay } from "../../domain/experts.generated";
import YjIcon from "../yijie/YjIcon.vue";
import ExpertAvatar from "./ExpertAvatar.vue";
defineProps<{ expert: ExpertDisplay; disabled?: boolean; pending?: boolean }>();
const emit = defineEmits<{ details: []; remove: [] }>();
</script>
<template>
  <div class="chat-expert-chip" :class="{ 'chat-expert-chip--removable': !disabled && !pending }" :aria-busy="pending">
    <button type="button" class="yj-control yj-control--pill chat-expert-chip__remove" :disabled="disabled || pending" aria-label="移除专家" title="移除专家，已有聊天保留" @click="!disabled && !pending && emit('remove')">
      <span class="chat-expert-chip__icon" aria-hidden="true">
        <ExpertAvatar :expert-id="expert.expertId" :icon-key="expert.iconKey" compact class="chat-expert-chip__symbol" />
        <YjIcon name="dismiss" size="sm" class="chat-expert-chip__dismiss" />
      </span>
    </button>
    <button type="button" class="yj-control yj-control--pill chat-expert-chip__details" :title="expert.displayName" :aria-label="`查看已选专家 ${expert.displayName}`" @click="emit('details')">
      <span>{{ expert.displayName }}</span>
    </button>
    <span v-if="pending" class="chat-expert-chip__status" role="status">正在切换专家</span>
  </div>
</template>
<style scoped>
.chat-expert-chip { position: relative; display: inline-flex; align-items: center; height: var(--yj-chat-expert-chip-height); min-width: 0; max-width: 100%; border: var(--yj-border-width) solid var(--yj-color-chat-expert-chip-border); border-radius: var(--yj-radius-full); }
.chat-expert-chip > button {
  -webkit-appearance: none;
  appearance: none;
  border: 0;
  height: 100%;
  min-height: 0;
  padding: 0;
  font-size: var(--yj-font-size-chat-expert-chip);
  font-weight: var(--yj-font-weight-medium);
  line-height: var(--yj-line-height-body);
  box-shadow: none;
  color: var(--yj-color-text-primary);
  background: transparent;
  cursor: pointer;
  transition: background var(--yj-motion-fast) var(--yj-ease-standard);
}
.chat-expert-chip:is(:hover, :focus-within) { background: var(--yj-color-control-hover); }
.chat-expert-chip > button:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.chat-expert-chip > button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.chat-expert-chip > button:disabled { color: var(--yj-color-text-disabled); cursor: default; opacity: 1; }
.chat-expert-chip > .chat-expert-chip__details { min-width: 0; padding-right: var(--yj-space-2); }
.chat-expert-chip__details span:first-of-type { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: calc(var(--yj-space-16) * 3); }
.chat-expert-chip > .chat-expert-chip__remove { flex: none; width: var(--yj-chat-expert-chip-height); }
.chat-expert-chip__icon { display: inline-grid; place-items: center; width: var(--yj-space-6); height: var(--yj-space-6); }
.chat-expert-chip__icon > * { grid-area: 1 / 1; }
.chat-expert-chip__dismiss { visibility: hidden; }
.chat-expert-chip--removable:is(:hover, :focus-within) .chat-expert-chip__symbol { visibility: hidden; }
.chat-expert-chip--removable:is(:hover, :focus-within) .chat-expert-chip__dismiss { visibility: visible; }
.chat-expert-chip__status { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (hover: none) { .chat-expert-chip--removable .chat-expert-chip__symbol { visibility: hidden; } .chat-expert-chip--removable .chat-expert-chip__dismiss { visibility: visible; } }
</style>
