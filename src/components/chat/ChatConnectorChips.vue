<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { NPopover, NTooltip } from "naive-ui";
import type { ConnectorChipView } from "../../domain/connector-ui";
import ConnectorIcon from "../connectors/ConnectorIcon.vue";

const props = defineProps<{ entries: readonly ConnectorChipView[]; disabled?: boolean }>();
defineSlots<{ default(props: { close: () => Promise<void> }): unknown }>();
const open = ref(false);
const group = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null), overlay = ref<HTMLElement | null>(null);
const panelId = useId();
const placement = ref<"top-start" | "bottom-start">("top-start");
const height = ref(0), width = ref(0);
let trigger: HTMLButtonElement | null = null;
function measure(): void {
  if (!open.value || !group.value) return;
  const style = getComputedStyle(document.documentElement);
  const scale = Number.parseFloat(style.getPropertyValue("--yj-ui-scale")) || 1;
  const inset = Number.parseFloat(style.getPropertyValue("--yj-space-4")) || 16;
  const gap = Number.parseFloat(style.getPropertyValue("--yj-space-2")) || 8;
  const bounds = group.value.getBoundingClientRect();
  const above = bounds.top / scale - inset - gap;
  const below = (window.innerHeight - bounds.bottom) / scale - inset - gap;
  placement.value = above >= below ? "top-start" : "bottom-start";
  height.value = Math.max(0, above, below);
  width.value = Math.max(0, window.innerWidth / scale - inset * 2);
}
async function show(event: Event): Promise<void> {
  if (props.disabled) return;
  trigger = event.currentTarget as HTMLButtonElement;
  open.value = true;
  measure();
  await nextTick();
  if (open.value) panel.value?.focus({ preventScroll: true });
}
async function close(): Promise<void> {
  open.value = false;
  await nextTick();
  if (trigger?.isConnected && !props.disabled) trigger.focus({ preventScroll: true });
}
watch(() => props.disabled, disabled => { if (disabled) open.value = false; });
watch(() => props.entries.length, () => { void nextTick(measure); });
onMounted(() => { window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true); });
onBeforeUnmount(() => {
  window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true);
  // Turning off the final connector removes this trigger group. Keep keyboard
  // navigation in the composer rather than leaving focus on a detached switch.
  if (open.value && panel.value?.contains(document.activeElement)) {
    const add = group.value?.closest(".chat-composer")?.querySelector<HTMLButtonElement>(".chat-composer__add");
    void nextTick(() => { if (add?.isConnected && !add.disabled) add.focus({ preventScroll: true }); });
  }
});
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover :show="open" :to="overlay ?? false" trigger="manual" :placement="placement" :show-arrow="false" :animated="false" raw @clickoutside="open = false">
    <template #trigger>
      <ul ref="group" class="chat-connector-chips" aria-label="本轮使用的连接器">
        <li v-for="entry in entries" :key="entry.id" class="chat-connector-chip">
          <NTooltip :show="open ? false : undefined" :disabled="open" placement="top" :show-arrow="false" trigger="hover">
            <template #trigger>
              <button type="button" class="chat-connector-chip__button" :class="{ 'chat-connector-chip__button--unavailable': entry.unavailableReason }"
                :disabled="disabled" :aria-label="`连接器：${entry.name}${entry.unavailableReason ? `，${entry.unavailableReason}` : ''}`"
                aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? panelId : undefined"
                @click="show" @keydown.down.prevent="show" @keydown.esc.stop.prevent="close">
                <ConnectorIcon :asset-id="entry.iconAssetId" size="xs" />
              </button>
            </template>
            连接器：{{ entry.name }}<template v-if="entry.unavailableReason"> · {{ entry.unavailableReason }}</template>
          </NTooltip>
        </li>
      </ul>
    </template>
    <div v-if="open" :id="panelId" ref="panel" class="chat-connector-popup chat-control-menu" role="dialog" aria-label="连接器" tabindex="-1"
      :style="{ maxHeight: `${height}px`, maxWidth: `${width}px` }" @keydown.esc.stop.prevent="close">
      <slot :close="close" />
    </div>
  </NPopover>
</template>

<style scoped>
.chat-connector-chips { display: flex; flex-wrap: wrap; flex: 0 1 auto; min-width: 0; max-width: 100%; list-style: none; margin: 0; padding: var(--yj-space-1); padding-inline-start: var(--yj-space-2); }
.chat-connector-chip { display: flex; margin-inline-start: calc(-1 * var(--yj-space-1)); }
.chat-connector-chip:is(:hover, :focus-within) { z-index: 1; }
.chat-connector-chip__button { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-6); height: var(--yj-space-6); padding: 0; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-full); background: var(--yj-color-bg-card); cursor: pointer; }
.chat-connector-chip__button :deep(.connector-icon) { width: var(--yj-space-4); height: var(--yj-space-4); }
.chat-connector-chip__button:hover:not(:disabled) { background: var(--yj-color-control-hover); }
.chat-connector-chip__button:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.chat-connector-chip__button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
.chat-connector-chip__button:disabled { cursor: default; background: var(--yj-color-control-disabled-bg); }
.chat-connector-chip__button--unavailable { border-color: var(--yj-color-semantic-warning-ink); }
.chat-connector-popup { display: flex; flex-direction: column; width: var(--yj-layout-connector-menu-width); min-height: 0; padding: 0; overflow: hidden; }
</style>
