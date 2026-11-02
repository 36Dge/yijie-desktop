<script setup lang="ts">
import { computed, ref } from "vue";
import { NTooltip } from "naive-ui";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{label: string; icon: YjIconName; tooltip?: string; pressed?: boolean; busy?: boolean; disabled?: boolean; tooltipDisabled?: boolean; preserveSelection?: boolean; error?: boolean; expanded?: boolean; controls?: string}>(), {pressed: undefined, expanded: undefined});
const emit = defineEmits<{click: [event: MouseEvent]}>();
const button = ref<HTMLButtonElement | null>(null);
const hovering = ref(false), focused = ref(false), dismissed = ref(false);
const show = computed(() => !props.tooltipDisabled && !dismissed.value && (hovering.value || focused.value));
function focus() { button.value?.focus({preventScroll:true}); }
function preserve(event: Event) { if (props.preserveSelection) event.preventDefault(); }
defineExpose({focus});
</script>

<template>
  <NTooltip trigger="manual" :show="show" placement="bottom" :show-arrow="false" :style="{zoom:'var(--yj-ui-scale, 1)'}">
    <template #trigger>
      <button ref="button" type="button" class="chat-answer-action" :class="{'is-selected': pressed, 'is-error': error}"
        :aria-label="label" :aria-pressed="pressed" :aria-disabled="disabled || undefined" :aria-busy="busy || undefined"
        :aria-expanded="expanded" :aria-controls="controls"
        @mouseenter="hovering=true; dismissed=false" @mouseleave="hovering=false" @focus="focused=true; dismissed=false" @blur="focused=false"
        @keydown.esc="dismissed=true" @pointerdown="preserve" @mousedown="preserve" @click="!disabled && emit('click', $event)">
        <YjIcon :name="icon" size="sm" :stroke-width="1.5" />
      </button>
    </template>
    {{ tooltip ?? label }}
  </NTooltip>
</template>

<style scoped>
.chat-answer-action {
  display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
  width: var(--yj-space-8); height: var(--yj-space-8); padding: 0;
  border: var(--yj-border-width) solid transparent; border-radius: var(--yj-radius-sm);
  color: var(--yj-color-icon-muted); background: transparent; cursor: pointer;
}
.chat-answer-action :deep(.yj-icon) { color: inherit; }
.chat-answer-action:hover:not([aria-disabled="true"]), .chat-answer-action.is-selected {
  color: var(--yj-color-text-primary); background: var(--yj-color-control-hover);
}
.chat-answer-action.is-selected { background: var(--yj-color-control-pressed); }
.chat-answer-action:active:not([aria-disabled="true"]) { background: var(--yj-color-control-pressed); }
.chat-answer-action.is-error { color: var(--yj-color-semantic-error-ink); }
.chat-answer-action[aria-disabled="true"] { color: var(--yj-color-text-disabled); cursor: default; }
.chat-answer-action:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
