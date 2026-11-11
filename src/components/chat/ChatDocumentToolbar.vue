<script setup lang="ts">
import { NPopover } from "naive-ui";
import { ref } from "vue";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

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
const popupHeight = ref(64);
const popupWidth = ref("var(--yj-layout-preview-path-max)");
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
    popupHeight.value = Math.max(1, Math.floor(bounds.top / (scale || 1) - 8));
    const left = bounds.right / (scale || 1) - 8;
    const right = (window.innerWidth - bounds.left) / (scale || 1) - 8;
    const maximum = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--yj-layout-preview-path-max")) || 600;
    popupPlacement.value = left >= right ? "top-end" : "top-start";
    popupWidth.value = `${Math.max(1, Math.min(maximum, Math.max(left, right)))}px`;
  }
  emit("update:pathOpen", open);
}
</script>

<template>
  <div class="document-toolbar" role="toolbar" aria-label="文档操作">
    <div class="document-toolbar__identity">
      <strong class="document-toolbar__name">{{ name }}</strong>
      <NPopover :show="pathOpen" :disabled="!enabled" trigger="hover" :placement="popupPlacement" :flip="false" :show-arrow="false"
        class="document-toolbar__path-popover" :style="{ maxHeight: `${popupHeight}px`, maxWidth: popupWidth, overflowY: 'auto', boxSizing: 'border-box' }" @update:show="setPathOpen">
        <template #trigger>
          <button ref="pathTrigger" class="document-toolbar__button" type="button" aria-label="文件路径" :disabled="!enabled" :aria-expanded="pathOpen"
            @focus="setPathOpen(true)" @blur="setPathOpen(false)" @keydown.esc.stop.prevent="setPathOpen(false)">
            <YjIcon name="folder" size="sm" :stroke-width="1.5" />
          </button>
        </template>
        <div class="document-toolbar__path yj-selectable-text" aria-label="文档路径" @keydown.esc.stop.prevent="$emit('update:pathOpen', false)">
          <YjIcon name="computer" size="sm" :stroke-width="1.5" />
          <span>{{ pathState === 'ready' ? path : pathState === 'error' ? '暂时无法定位本地文件' : '正在读取路径…' }}</span>
        </div>
      </NPopover>
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
.document-toolbar__path { display: flex; align-items: flex-start; gap: var(--yj-space-2); max-width: 100%; color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.document-toolbar__path > span { min-width: 0; overflow-wrap: anywhere; }
.document-toolbar__path :deep(.yj-icon) { flex: none; margin-top: var(--yj-space-1); color: inherit; }
</style>
