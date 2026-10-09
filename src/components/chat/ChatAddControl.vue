<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { NPopover, NTooltip } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";

type Resource = "skills" | "connectors";
const props = defineProps<{ disabled: boolean; attachmentDisabled: boolean; skillsAvailable: boolean; connectorsAvailable: boolean }>();
const emit = defineEmits<{ "pick-attachments": [] }>();
defineSlots<{ skills(props: { close: () => void }): unknown; connectors(props: { close: () => void }): unknown }>();
const open = ref(false), view = ref<Resource | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null), primary = ref<HTMLElement | null>(null), submenu = ref<HTMLElement | null>(null);
const overlay = ref<HTMLElement | null>(null);
const panelId = useId(), submenuId = useId();
const placement = ref<"top-start" | "bottom-start">("top-start");
const height = ref(0), shiftX = ref(0);
const submenuX = ref(0), submenuY = ref(0), submenuHeight = ref(0);
const submenuSide = ref<"right" | "left" | "stacked">("right");
let closeTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | undefined;
let frame = 0;

function metrics() {
  const style = getComputedStyle(document.documentElement);
  return {
    scale: Number.parseFloat(style.getPropertyValue("--yj-ui-scale")) || 1,
    inset: Number.parseFloat(style.getPropertyValue("--yj-space-4")) || 16,
    gap: Number.parseFloat(style.getPropertyValue("--yj-space-2")) || 8,
    menuWidth: Number.parseFloat(style.getPropertyValue("--yj-layout-composer-add-menu-width")) || 200,
    resourceWidth: Number.parseFloat(style.getPropertyValue("--yj-layout-connector-menu-width")) || 260,
  };
}
function resourceTrigger(value = view.value): HTMLButtonElement | null {
  return primary.value?.querySelector<HTMLButtonElement>(`[data-resource-menu="${value}"]`) ?? null;
}
function measureSubmenu(): void {
  if (!open.value || !panel.value || !submenu.value || !view.value) return;
  const { scale, inset, gap, resourceWidth } = metrics();
  const bounds = panel.value.getBoundingClientRect();
  const anchor = resourceTrigger()?.getBoundingClientRect();
  const width = Math.min(resourceWidth, window.innerWidth / scale - inset * 2);
  const left = bounds.left / scale, top = bounds.top / scale;
  const parentWidth = bounds.width / scale;
  const viewportWidth = window.innerWidth / scale, viewportHeight = window.innerHeight / scale;
  submenuHeight.value = Math.max(0, viewportHeight - inset * 2);
  const childHeight = Math.min(submenu.value.getBoundingClientRect().height / scale, submenuHeight.value);
  let y = ((anchor?.top ?? bounds.top) - bounds.top) / scale;
  if (left + parentWidth + gap + width <= viewportWidth - inset) {
    submenuSide.value = "right"; submenuX.value = parentWidth + gap;
  } else if (left - gap - width >= inset) {
    submenuSide.value = "left"; submenuX.value = -gap - width;
  } else {
    submenuSide.value = "stacked";
    submenuX.value = Math.max(inset - left, Math.min(0, viewportWidth - inset - left - width));
    const below = viewportHeight - bounds.bottom / scale - inset - gap;
    const above = top - inset - gap;
    // A narrow viewport keeps both panels reachable instead of clipping a
    // horizontally overflowing cascade. Only the resource list scrolls.
    const available = Math.max(above, below, 0);
    submenuHeight.value = available;
    const stackedHeight = Math.min(childHeight, available);
    y = below >= above ? bounds.height / scale + gap : -gap - stackedHeight;
  }
  submenuY.value = submenuSide.value === "stacked" ? y : Math.max(inset - top, Math.min(y, viewportHeight - inset - top - childHeight));
}
function queueMeasureSubmenu(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measureSubmenu);
}
function measure(): void {
  if (!open.value || !trigger.value) return;
  const { scale, inset, gap, menuWidth } = metrics();
  const bounds = trigger.value.getBoundingClientRect();
  const viewportWidth = window.innerWidth / scale;
  const width = Math.min(menuWidth, viewportWidth - inset * 2);
  shiftX.value = Math.max(inset - bounds.left / scale, Math.min(0, viewportWidth - inset - bounds.left / scale - width));
  const above = bounds.top / scale - inset - gap;
  const below = (window.innerHeight - bounds.bottom) / scale - inset - gap;
  placement.value = above >= below ? "top-start" : "bottom-start";
  height.value = Math.max(0, above, below);
  queueMeasureSubmenu();
}
function cancelClose(): void { clearTimeout(closeTimer); closeTimer = undefined; }
function leave(): void {
  cancelClose();
  const delay = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--yj-motion-base")) || 180;
  closeTimer = setTimeout(() => {
    if (!submenu.value?.contains(document.activeElement)) view.value = null;
  }, delay);
}
async function setOpen(value: boolean, restoreFocus = false): Promise<void> {
  if (value && props.disabled) return;
  cancelClose(); open.value = value; view.value = null;
  if (value) {
    measure(); await nextTick();
    if (open.value) primary.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  } else if (restoreFocus) { await nextTick(); trigger.value?.focus({ preventScroll: true }); }
}
function close(): void { void setOpen(false, true); }
async function closeSubmenu(): Promise<void> {
  const parent = resourceTrigger(); cancelClose(); view.value = null;
  await nextTick(); parent?.focus({ preventScroll: true });
}
async function showView(value: Resource, focus = false): Promise<void> {
  if (!open.value || props.disabled || (value === "skills" ? !props.skillsAvailable : !props.connectorsAvailable)) return;
  cancelClose(); view.value = value;
  await nextTick(); measureSubmenu(); queueMeasureSubmenu();
  if (focus && view.value === value) submenu.value?.focus({ preventScroll: true });
}
function pickAttachments(): void {
  if (props.attachmentDisabled) return;
  close(); emit("pick-attachments");
}
function navigate(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    if (view.value) void closeSubmenu(); else close();
    return;
  }
  if (event.key === "ArrowLeft" && view.value && submenu.value?.contains(event.target as Node) && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault(); event.stopPropagation(); void closeSubmenu(); return;
  }
  if (!primary.value?.contains(event.target as Node) || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [...primary.value.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  if (!buttons.length) return;
  event.preventDefault(); view.value = null;
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
  buttons[target]?.focus({ preventScroll: true });
}
watch(submenu, value => {
  observer?.disconnect();
  if (value && typeof ResizeObserver !== "undefined") {
    observer ??= new ResizeObserver(queueMeasureSubmenu);
    observer.observe(value);
  }
});
watch(() => props.disabled, value => { if (value) void setOpen(false); });
watch(() => [props.skillsAvailable, props.connectorsAvailable], () => {
  if ((view.value === "skills" && !props.skillsAvailable) || (view.value === "connectors" && !props.connectorsAvailable)) close();
});
onMounted(() => {
  window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true);
});
onBeforeUnmount(() => {
  cancelClose(); cancelAnimationFrame(frame); observer?.disconnect();
  window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true);
});
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <!-- Cascades must measure at their final size even when entered immediately. -->
  <NPopover :show="open" :to="overlay ?? false" trigger="click" :placement="placement" :flip="false" :animated="false" :show-arrow="false" raw :disabled="disabled" @update:show="setOpen">
    <template #trigger>
      <NTooltip :disabled="open || disabled" :to="overlay ?? false" placement="top" :style="{ zoom: 'var(--yj-ui-scale, 1)' }">
        <template #trigger>
          <button ref="trigger" class="chat-composer__add" type="button" :disabled="disabled" aria-label="可添加文件、技能、连接器" aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? panelId : undefined" @keydown.down.prevent="setOpen(true)" @keydown.esc.stop.prevent="close"><YjIcon name="plus" size="lg" /></button>
        </template>
        可添加文件、技能、连接器
      </NTooltip>
    </template>
    <div :id="panelId" ref="panel" class="composer-add-menu" :style="{ '--add-menu-height': `${height}px`, '--add-menu-shift-x': `${shiftX}px` }" role="dialog" aria-label="添加到对话" @mouseenter="cancelClose" @mouseleave="leave" @keydown="navigate">
      <div ref="primary" class="composer-add-menu__primary chat-control-menu" role="menu" aria-label="添加到对话">
        <button class="chat-control-option" role="menuitem" type="button" :disabled="attachmentDisabled" @mouseenter="view = null" @click="pickAttachments"><YjIcon name="file" size="sm" /><span>添加文件</span></button>
        <div class="composer-add-menu__separator" role="separator" />
        <button class="chat-control-option" role="menuitem" type="button" data-resource-menu="skills" :disabled="!skillsAvailable" aria-haspopup="dialog" :aria-expanded="view === 'skills'" :aria-controls="view === 'skills' ? submenuId : undefined" @mouseenter="showView('skills')" @click="showView('skills', true)" @keydown.right.prevent="showView('skills', true)"><YjIcon name="skillOperations" size="sm" /><span>技能</span><YjIcon name="chevronRight" size="sm" tone="muted" /></button>
        <button class="chat-control-option" role="menuitem" type="button" data-resource-menu="connectors" :disabled="!connectorsAvailable" aria-haspopup="dialog" :aria-expanded="view === 'connectors'" :aria-controls="view === 'connectors' ? submenuId : undefined" @mouseenter="showView('connectors')" @click="showView('connectors', true)" @keydown.right.prevent="showView('connectors', true)"><YjIcon name="connector" size="sm" /><span>连接器</span><YjIcon name="chevronRight" size="sm" tone="muted" /></button>
      </div>
      <div v-if="view" :id="submenuId" ref="submenu" class="composer-add-menu__submenu chat-control-menu" :data-side="submenuSide" :style="{ left: `${submenuX}px`, top: `${submenuY}px`, maxHeight: `${submenuHeight}px` }" role="dialog" tabindex="-1" :aria-label="view === 'skills' ? '技能' : '连接器'" @mouseenter="cancelClose">
        <slot v-if="view === 'skills'" name="skills" :close="close" />
        <slot v-else name="connectors" :close="close" />
      </div>
    </div>
  </NPopover>
</template>

<style scoped>
.chat-composer__add { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-full); color: var(--yj-color-text-primary); background: transparent; cursor: pointer; }
.chat-composer__add:hover:not(:disabled), .chat-composer__add[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.chat-composer__add:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.chat-composer__add:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-composer__add:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-composer__add .yj-icon { transition: transform var(--yj-motion-fast) var(--yj-ease-standard); }
.chat-composer__add[aria-expanded="true"] .yj-icon { transform: rotate(45deg); }
.composer-add-menu { position: relative; width: min(var(--yj-layout-composer-add-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); pointer-events: auto; zoom: var(--yj-ui-scale, 1); translate: var(--add-menu-shift-x) 0; }
.composer-add-menu__primary { width: 100%; max-height: var(--add-menu-height); overflow-y: auto; padding: var(--yj-space-1); zoom: 1; }
.chat-control-option { user-select: none; min-height: var(--yj-control-height-md); padding: var(--yj-space-2) var(--yj-space-3); gap: var(--yj-space-2); }
.chat-control-option[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.chat-control-option > span { flex: 1; }
.composer-add-menu__separator { margin: var(--yj-space-1) var(--yj-space-2); border-top: var(--yj-border-width) solid var(--yj-color-border-default); }
.composer-add-menu__submenu { position: absolute; display: flex; flex-direction: column; width: min(var(--yj-layout-connector-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8))); padding: 0; zoom: 1; }
.composer-add-menu__submenu:focus { outline: none; }
.composer-add-menu__submenu::before { content: ""; position: absolute; top: 0; bottom: 0; width: var(--yj-space-2); }
.composer-add-menu__submenu[data-side="right"]::before { right: 100%; }
.composer-add-menu__submenu[data-side="left"]::before { left: 100%; }
.composer-add-menu__submenu[data-side="stacked"]::before { display: none; }
@media (prefers-reduced-motion: reduce) { .chat-composer__add .yj-icon { transition: none; } }
</style>
