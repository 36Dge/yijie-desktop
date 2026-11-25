<script setup lang="ts">
import { nextTick, ref, useId, watch } from "vue";
import { NPopover } from "naive-ui";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{ label: string; value: string; placeholder?: string; panelLabel: string; icon: YjIconName; disabled: boolean; describedBy: string }>();
const emit = defineEmits<{ open: [] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelId = useId();
const placement = ref<"top-start" | "bottom-start">("bottom-start");
const availableHeight = ref<number>();
const shift = ref(0);
let naturalHeight = 0;

function fit(event?: Event) {
  const field = trigger.value;
  if (!field || !panel.value || (event?.target instanceof Node && panel.value.contains(event.target))) return;
  const anchor = field.getBoundingClientRect();
  const dialog = field.closest('[aria-modal="true"]')?.getBoundingClientRect();
  const style = getComputedStyle(field);
  const scale = Number.parseFloat(style.getPropertyValue("--yj-ui-scale")) || 1;
  const gap = Number.parseFloat(style.getPropertyValue("--yj-space-1")) || 0;
  const minY = Math.max(0, dialog?.top ?? 0) + gap * scale;
  const maxY = Math.min(window.innerHeight, dialog?.bottom ?? window.innerHeight) - gap * scale;
  availableHeight.value = Math.max(0, Math.floor((maxY - minY) / scale));
  const height = Math.min(naturalHeight, availableHeight.value) * scale;
  const below = maxY - anchor.bottom, above = anchor.top - minY;
  const bottom = below >= height + gap * scale || below >= above;
  placement.value = bottom ? "bottom-start" : "top-start";
  // If neither side fits at reading zoom, slide the whole panel into the dialog.
  const origin = bottom ? anchor.bottom : anchor.top - height;
  const top = Math.max(minY, Math.min(origin + (bottom ? gap : -gap) * scale, maxY - height));
  shift.value = (top - origin) / scale;
}

async function toggle(visible: boolean) {
  if (visible && props.disabled) return;
  if (visible) { availableHeight.value = undefined; shift.value = 0; emit("open"); }
  open.value = visible;
  if (visible) {
    await nextTick();
    if (open.value && panel.value) {
      naturalHeight = panel.value.offsetHeight;
      fit();
      panel.value.querySelector<HTMLElement>("[data-picker-focus]")?.focus({ preventScroll: true });
    }
  }
}
function finish() {
  open.value = false;
  trigger.value?.focus({ preventScroll: true });
}
function leave(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && next !== trigger.value && !panel.value?.contains(next)) open.value = false;
}
watch(() => props.disabled, disabled => { if (disabled) open.value = false; });
watch(open, (visible, _, cleanup) => {
  if (!visible) return;
  window.addEventListener("resize", fit);
  document.addEventListener("scroll", fit, true);
  cleanup(() => { window.removeEventListener("resize", fit); document.removeEventListener("scroll", fit, true); });
});
</script>

<template>
  <NPopover :show="open" trigger="click" :placement="placement" :flip="false" class="schedule-picker-popover" :style="{ top: `${shift}px` }"
    :disabled="disabled" :show-arrow="false" :animated="false" raw @update:show="toggle">
    <template #trigger>
      <button ref="trigger" type="button" class="schedule-picker-trigger yj-control" :class="{ 'is-empty': !value }"
        :disabled="disabled" :aria-label="value ? `${label}，${value}` : label" :aria-describedby="describedBy"
        aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? panelId : undefined" @keydown.down.prevent="toggle(true)">
        {{ value || placeholder }}<YjIcon :name="icon" size="sm" tone="muted" />
      </button>
    </template>
    <div :id="panelId" ref="panel" class="schedule-picker-panel" role="dialog" :aria-label="panelLabel"
      :style="availableHeight !== undefined ? { '--schedule-picker-height': `${availableHeight}px` } : undefined"
      @focusout="leave" @keydown.esc.stop.prevent="finish">
      <slot :finish="finish" />
    </div>
  </NPopover>
</template>

<style scoped>
.schedule-picker-trigger {
  width: 100%; min-height: var(--yj-control-height-md); justify-content: space-between;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  background: var(--yj-color-bg-card); color: var(--yj-color-text-primary);
  font-weight: var(--yj-font-weight-regular); font-variant-numeric: tabular-nums;
}
.schedule-picker-trigger:hover:not(:disabled) { border-color: var(--yj-color-border-default); }
.schedule-picker-trigger:focus-visible, .schedule-picker-trigger[aria-expanded="true"] { outline: none; border-color: var(--yj-color-border-strong); }
.schedule-picker-trigger.is-empty { color: var(--yj-color-text-tertiary); }
.schedule-picker-trigger:disabled { background: var(--yj-color-control-disabled-bg); color: var(--yj-color-text-disabled); cursor: default; }
/* Naive measures anchors in viewport pixels. Apply the dialog's zoom once to the surface. */
:global(.v-binder-follower-container:has(> .v-binder-follower-content > .schedule-picker-popover)) { zoom: calc(1 / var(--yj-ui-scale, 1)); }
:global(.n-popover.n-popover--raw.schedule-picker-popover) { position: relative; margin: 0; zoom: var(--yj-ui-scale, 1); background: transparent; box-shadow: none; }
.schedule-picker-panel {
  max-height: var(--schedule-picker-height, none); overflow-y: auto; overscroll-behavior: contain;
  padding: var(--yj-space-3); border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary);
  box-shadow: var(--yj-shadow-popover); font-variant-numeric: tabular-nums;
}
</style>
