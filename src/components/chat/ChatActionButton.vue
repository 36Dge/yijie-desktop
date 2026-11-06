<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NTooltip } from "naive-ui";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{label: string; icon: YjIconName; tooltip?: string; pressed?: boolean; busy?: boolean; disabled?: boolean; tooltipDisabled?: boolean; preserveSelection?: boolean; error?: boolean; expanded?: boolean; controls?: string}>(), {pressed: undefined, expanded: undefined});
const emit = defineEmits<{click: [event: MouseEvent]}>();
const button = ref<HTMLButtonElement | null>(null);
const hovering = ref(false), keyboardFocused = ref(false), dismissed = ref(false);
const show = computed(() => !props.tooltipDisabled && !dismissed.value && (hovering.value || keyboardFocused.value));
const displayIcon = computed(() => {
  if (props.pressed && props.icon === "thumbsUp") return "thumbsUpFilled";
  if (props.pressed && props.icon === "thumbsDown") return "thumbsDownFilled";
  return props.icon;
});
function dismissTooltip() {
  hovering.value = false;
  keyboardFocused.value = false;
  dismissed.value = true;
}
function focus() {
  button.value?.focus({preventScroll:true});
  // Return focus from the feedback panel without reopening its tooltip.
  dismissTooltip();
}
function onFocus(event: FocusEvent) {
  keyboardFocused.value = !props.tooltipDisabled && (event.currentTarget as HTMLElement).matches(":focus-visible");
  if (keyboardFocused.value) dismissed.value = false;
}
function enter() {
  if (props.tooltipDisabled) return;
  hovering.value = true;
  dismissed.value = false;
}
function preserve(event: Event) { if (props.preserveSelection) event.preventDefault(); }
watch(() => props.tooltipDisabled, disabled => { if (disabled) dismissTooltip(); });
watch(keyboardFocused, (focused, _, cleanup) => {
  if (!focused) return;
  // Safari may retain button focus after a mouse click, including Copy's
  // selection-preserving click. Pointer interaction ends the keyboard hint.
  const pointer = () => { keyboardFocused.value = false; };
  document.addEventListener("pointerdown", pointer, true);
  cleanup(() => document.removeEventListener("pointerdown", pointer, true));
});
defineExpose({focus});
</script>

<template>
  <NTooltip arrow-point-to-center trigger="manual" :show="show" placement="bottom"  :style="{zoom:'var(--yj-ui-scale, 1)'}">
    <template #trigger>
      <button ref="button" type="button" class="chat-answer-action" :class="{'is-selected': pressed, 'is-error': error}"
        :aria-label="label" :aria-pressed="pressed" :aria-disabled="disabled || undefined" :aria-busy="busy || undefined"
        :aria-expanded="expanded" :aria-controls="controls"
        @mouseenter="enter" @mouseleave="hovering=false; keyboardFocused=false" @focus="onFocus" @blur="keyboardFocused=false"
        @keydown.esc="dismissTooltip" @pointerdown="preserve" @mousedown="preserve" @click="!disabled && emit('click', $event)">
        <YjIcon :name="displayIcon" size="sm" :stroke-width="1.5" />
      </button>
    </template>
    {{ tooltip ?? label }}
  </NTooltip>
</template>

<style scoped>
.chat-answer-action {
  position: relative;
  display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
  width: var(--yj-space-8); height: var(--yj-space-8); padding: 0;
  border: var(--yj-border-width) solid transparent; border-radius: var(--yj-radius-sm);
  color: var(--yj-color-icon-muted); background: transparent; cursor: pointer;
}
.chat-answer-action::before {
  content: "";
  position: absolute;
  width: var(--yj-space-6); height: var(--yj-space-6);
  top: 50%; left: 50%; transform: translate(-50%, -50%);
  border-radius: inherit;
  background: var(--chat-answer-action-background, transparent);
  pointer-events: none;
}
.chat-answer-action :deep(.yj-icon) { position: relative; color: inherit; }
.chat-answer-action:hover:not([aria-disabled="true"]):not(.is-selected) {
  --chat-answer-action-background: var(--yj-color-control-hover);
  color: var(--yj-color-text-primary);
}
.chat-answer-action.is-selected { color: var(--yj-color-text-secondary); background: transparent; }
.chat-answer-action:active:not([aria-disabled="true"]):not(.is-selected) { --chat-answer-action-background: var(--yj-color-control-pressed); }
.chat-answer-action.is-error { color: var(--yj-color-semantic-error-ink); }
.chat-answer-action[aria-disabled="true"] { color: var(--yj-color-text-disabled); cursor: default; }
.chat-answer-action:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
</style>
