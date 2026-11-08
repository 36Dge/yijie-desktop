<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from "vue";
import { NPopover } from "naive-ui";
import type { ContextWindowSample } from "../../api/context-window-client";
import { contextWindowPresentation } from "../../domain/context-window";

const props = defineProps<{ sample: ContextWindowSample | null }>();
const text = computed(() => contextWindowPresentation(props.sample));
const id = useId();
const overlay = ref<HTMLElement | null>(null);
const hovered = ref(false), focused = ref(false), dismissed = ref(false);
const open = computed(() => !dismissed.value && (hovered.value || focused.value));
let leaveTimer: ReturnType<typeof setTimeout> | undefined;
function enter() { clearTimeout(leaveTimer); hovered.value = true; dismissed.value = false; }
function leave() { clearTimeout(leaveTimer); leaveTimer = setTimeout(() => { hovered.value = false; }, 120); }
function focus() { focused.value = true; dismissed.value = false; }
onBeforeUnmount(() => clearTimeout(leaveTimer));
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover :to="overlay ?? false" trigger="manual" :show="open" placement="top" :show-arrow="false" raw
    @mouseenter="enter" @mouseleave="leave">
    <template #trigger>
      <button type="button" class="context-window__trigger yj-control yj-control--icon"
        :aria-label="`上下文窗口，${text.summary}`" :aria-describedby="open ? id : undefined"
        @mouseenter="enter" @mouseleave="leave" @focus="focus" @blur="focused = false"
        @keydown.esc.stop="dismissed = true">
        <svg class="context-window__ring" width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <circle class="context-window__track" cx="10" cy="10" r="8" />
          <circle v-if="text.percent !== null && text.percent > 0" class="context-window__usage"
            cx="10" cy="10" r="8" pathLength="100" :stroke-dasharray="`${Math.min(100, text.percent)} 100`"
            transform="rotate(-90 10 10)" />
        </svg>
      </button>
    </template>
    <div :id="id" role="tooltip" class="context-window__popover">
      <div class="context-window__title">上下文窗口：</div>
      <div class="context-window__usage-copy">{{ text.summary }}</div>
      <div v-if="text.tokens" class="context-window__tokens">{{ text.tokens }}</div>
    </div>
  </NPopover>
</template>

<style scoped>
.context-window__trigger {
  appearance: none;
  flex: none;
  margin-inline-end: calc(-1 * var(--yj-space-1));
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--yj-color-icon-default);
}
.context-window__trigger:hover { background: var(--yj-color-control-hover); }
.context-window__trigger:active { background: var(--yj-color-control-pressed); }
.context-window__ring {
  fill: none;
  stroke-width: 2.5;
}
.context-window__track { stroke: var(--yj-color-border-default); }
.context-window__usage { stroke: var(--yj-color-border-control); stroke-linecap: round; }
.context-window__popover {
  pointer-events: auto;
  max-width: min(var(--yj-tooltip-max-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)));
  padding: var(--yj-space-1) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-context-window-border);
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-context-window-bg);
  color: var(--yj-color-context-window-text);
  box-shadow: var(--yj-shadow-popover);
  font-family: var(--yj-font-family-sans);
  font-size: var(--yj-font-size-context-window);
  font-weight: var(--yj-font-weight-regular);
  line-height: var(--yj-line-height-context-window);
  font-variant-numeric: tabular-nums;
  text-align: center;
  overflow-wrap: anywhere;
  zoom: var(--yj-ui-scale, 1);
}
.context-window__title {
  color: var(--yj-color-context-window-muted);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-regular);
}
.context-window__usage-copy { color: var(--yj-color-context-window-text); }
.context-window__tokens {
  word-spacing: -0.06em;
}
.context-window__trigger:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-focus-ring-width);
}
</style>
