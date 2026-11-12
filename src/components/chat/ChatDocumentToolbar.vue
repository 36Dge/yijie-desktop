<script setup lang="ts">
import { NTooltip } from "naive-ui";
import { ref, useId } from "vue";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";

withDefaults(defineProps<{
  name: string;
  path: string | null;
  pathState: "idle" | "loading" | "ready" | "error";
  pathOpen: boolean;
  saving: boolean;
  canSave: boolean;
  enabled?: boolean;
}>(), { enabled: true });
const emit = defineEmits<{ "update:pathOpen": [value: boolean]; save: [] }>();
const pathTrigger = ref<HTMLButtonElement | null>(null);
const pathViewport = ref<HTMLElement | null>(null);
const pathContent = ref<HTMLElement | null>(null);
const pathScrollbar = ref<InstanceType<typeof ChatShortScrollbar> | null>(null);
const pathId = `${useId()}-document-path`;
const popupHeight = ref(64);
const popupWidth = ref("var(--yj-tooltip-max-width)");
const popupPlacement = ref<"top-start" | "top-end">("top-end");
function setPathOpen(open: boolean) {
  if (open && pathTrigger.value) {
    const button = pathTrigger.value;
    const bounds = button.getBoundingClientRect();
    const height = Number.parseFloat(getComputedStyle(button).height);
    const scale = height > 0 ? bounds.height / height : 1;
    // The Native reader is a sibling view above the main WebView. Keep this
    // informational popup above the toolbar, never over that reader's surface.
    // A long path scrolls inside the available header area instead of flipping
    // below the button and hiding the entire Native document.
    const tokens = getComputedStyle(document.documentElement);
    const padding = Number.parseFloat(tokens.getPropertyValue("--yj-tooltip-padding-block")) || 4;
    const offset = (Number.parseFloat(tokens.getPropertyValue("--yj-tooltip-space")) || 5) + (Number.parseFloat(tokens.getPropertyValue("--yj-tooltip-arrow-height")) || 3);
    popupHeight.value = Math.max(1, Math.floor(bounds.top / (scale || 1) - 8 - padding * 2 - offset));
    const left = bounds.right / (scale || 1) - 8;
    const right = (window.innerWidth - bounds.left) / (scale || 1) - 8;
    const maximum = Number.parseFloat(tokens.getPropertyValue("--yj-tooltip-max-width")) || 320;
    popupPlacement.value = left >= right ? "top-end" : "top-start";
    popupWidth.value = `${Math.max(1, Math.min(maximum, Math.max(left, right)))}px`;
  }
  emit("update:pathOpen", open);
}
function updatePathHover(open: boolean) {
  if (!open && (pathViewport.value?.contains(document.activeElement) || pathScrollbar.value?.isDragging)) return;
  setPathOpen(open);
}
function closePathOutside(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && (pathTrigger.value?.contains(next) || pathViewport.value?.contains(next))) return;
  setPathOpen(false);
}
function dismissPath() {
  if (pathViewport.value?.contains(document.activeElement)) pathTrigger.value?.focus({ preventScroll: true });
  setPathOpen(false);
}
</script>

<template>
  <div class="document-toolbar" role="toolbar" aria-label="文档操作">
    <div class="document-toolbar__identity">
      <strong class="document-toolbar__name">{{ name }}</strong>
      <NTooltip :show="pathOpen" :disabled="!enabled" trigger="hover" :placement="popupPlacement" :flip="false" arrow-point-to-center
        class="document-toolbar__path-tooltip" :style="{ maxWidth: popupWidth, boxSizing: 'border-box' }" @update:show="updatePathHover">
        <template #trigger>
          <button ref="pathTrigger" class="document-toolbar__button" type="button" aria-label="文件路径" :disabled="!enabled" :aria-expanded="pathOpen" :aria-controls="pathId"
            @focus="setPathOpen(true)" @focusout="closePathOutside" @keydown.down.stop.prevent="pathViewport?.focus({ preventScroll: true })" @keydown.esc.stop.prevent="dismissPath">
            <YjIcon name="folder" size="sm" :stroke-width="1.5" />
          </button>
        </template>
        <div :id="pathId" ref="pathViewport" class="document-toolbar__path yj-selectable-text" :style="{ maxHeight: `${popupHeight}px` }" aria-label="文档路径" tabindex="0" @focusout="closePathOutside" @keydown.esc.stop.prevent="dismissPath">
          <div ref="pathContent" class="document-toolbar__path-content">
            <YjIcon name="computer" size="xs" :stroke-width="1.5" />
            <span>{{ pathState === 'ready' ? path : pathState === 'error' ? '暂时无法定位本地文件' : '正在读取路径…' }}</span>
          </div>
        </div>
        <ChatShortScrollbar ref="pathScrollbar" :viewport="pathViewport" :content="pathContent" :active="pathOpen" :controls="pathId" label="滚动文档路径" />
      </NTooltip>
    </div>
    <YjTooltip text="另存为">
      <button class="document-toolbar__button" type="button" aria-label="另存为" :disabled="!canSave" :aria-busy="saving" @click="$emit('save')">
        <YjIcon :name="saving ? 'pending' : 'download'" size="sm" :stroke-width="1.5" />
      </button>
    </YjTooltip>
  </div>
</template>

<style scoped>
.document-toolbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: var(--yj-space-3); min-height: var(--yj-space-12); padding: var(--yj-space-2) var(--yj-space-4); background: var(--yj-color-bg-page); }
.document-toolbar__identity { display: flex; min-width: 0; align-items: center; gap: var(--yj-space-1); }
.document-toolbar__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-body); }
.document-toolbar__button { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); color: var(--yj-color-text-secondary); background: transparent; cursor: pointer; }
.document-toolbar__button:hover:not(:disabled), .document-toolbar__button[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.document-toolbar__button:active:not(:disabled) { background: var(--yj-color-control-pressed); }
.document-toolbar__button:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.document-toolbar__button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-border-width); }
.document-toolbar__button :deep(.yj-icon) { color: inherit; }
.document-toolbar__path { --yj-layout-chat-scrollbar-width: var(--yj-space-1); --yj-layout-chat-scrollbar-thumb-height: 22px; display: grid; max-width: 100%; overflow-y: auto; scrollbar-width: none; color: inherit; font-size: inherit; line-height: inherit; }
.document-toolbar__path::-webkit-scrollbar { display: none; }
.document-toolbar__path-content { grid-area: 1 / 1; display: flex; align-items: flex-start; gap: var(--yj-space-2); min-width: 0; padding-inline-end: var(--yj-space-3); }
.document-toolbar__path-content > span { min-width: 0; overflow-wrap: anywhere; }
.document-toolbar__path :deep(.chat-short-scrollbar__thumb) { opacity: 1; }
.document-toolbar__path :deep(.chat-short-scrollbar__thumb::after) { border-radius: var(--yj-radius-full); background: color-mix(in srgb, var(--yj-color-tooltip-text) 20%, transparent); }
.document-toolbar__path :deep(.chat-short-scrollbar__thumb:hover::after) { background: color-mix(in srgb, var(--yj-color-tooltip-text) 35%, transparent); }
[data-theme="dark"] .document-toolbar__path :deep(.chat-short-scrollbar__thumb::after) { background: color-mix(in srgb, var(--yj-color-tooltip-text) 40%, transparent); }
[data-theme="dark"] .document-toolbar__path :deep(.chat-short-scrollbar__thumb:hover::after) { background: color-mix(in srgb, var(--yj-color-tooltip-text) 60%, transparent); }
.document-toolbar__path:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-tooltip-text); outline-offset: var(--yj-border-width); }
.document-toolbar__path :deep(.yj-icon) { flex: none; margin-top: var(--yj-space-1); color: inherit; }
</style>
