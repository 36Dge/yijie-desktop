<script setup lang="ts">
import { ref, useId, watch } from "vue";
import { NModal } from "naive-ui";
import { skillNativeClient, type SkillImportDrag, type SkillImportSelection } from "../../api/skill-native-client";
import YjIcon from "../../components/yijie/YjIcon.vue";
import { skillImportFailureMessage, useSkillStore } from "../../stores/skill.store";

const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ close: []; installed: [] }>();
const store = useSkillStore();
const api = skillNativeClient.importDialog;
const titleId = useId();
const requirementsId = useId();
const dropZone = ref<HTMLButtonElement | null>(null);
const selected = ref<SkillImportSelection | null>(null);
const error = ref<string | null>(null);
const ready = ref(false);
const preparing = ref(false);
const dragging = ref(false);
let currentDialog: string | null = null;

async function choose(dropId?: string): Promise<void> {
  const id = currentDialog;
  if (!id || !api || !ready.value || preparing.value || store.importing) return;
  error.value = null;
  preparing.value = true;
  dragging.value = false;
  try {
    const file = await api.prepare(id, dropId);
    if (id === currentDialog && file) selected.value = file;
  } catch (cause) {
    if (id === currentDialog) error.value = skillImportFailureMessage(cause);
  } finally {
    if (id === currentDialog) preparing.value = false;
  }
}

function handleDrag(event: SkillImportDrag): void {
  const bounds = dropZone.value?.getBoundingClientRect();
  if (!bounds || !ready.value || preparing.value || store.importing || event.type === "leave") {
    dragging.value = false;
    return;
  }
  // The Mac WebView reports AppKit points, in the same space as the DOM bounds.
  const { x, y } = event.position;
  const inside = x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
  dragging.value = inside && event.type === "over";
  if (inside && event.type === "drop") void choose(event.dropId);
}

watch(() => props.show, (show, _, onCleanup) => {
  if (!show || !api) return;
  const id = crypto.randomUUID();
  currentDialog = id;
  selected.value = null;
  error.value = null;
  ready.value = false;
  preparing.value = false;
  dragging.value = false;
  const opened = api.open(id, event => { if (id === currentDialog) handleDrag(event); });
  void opened.then(() => {
    if (id === currentDialog) ready.value = true;
  }, cause => {
    if (id === currentDialog) error.value = skillImportFailureMessage(cause) + " 请关闭弹窗后重试。";
  });
  onCleanup(() => {
    currentDialog = null;
    // A fast close may precede the native open acknowledgement.
    void opened.then(() => api.close(id)).catch(() => {});
  });
}, { immediate: true, flush: "sync" });

async function install(): Promise<void> {
  const id = currentDialog;
  if (!id || !selected.value || preparing.value || store.importing) return;
  error.value = null;
  const installed = await store.importSkill({ dialogId: id, selectionId: selected.value.id });
  if (id !== currentDialog) return;
  if (installed) emit("installed");
  else error.value = store.importError;
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="!store.importing"
    :close-on-esc="!store.importing"
    transform-origin="center"
    @update:show="!$event && emit('close')"
  >
    <section class="skill-import-dialog" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header class="skill-import-dialog__header">
        <h2 :id="titleId">安装技能</h2>
        <button type="button" class="skill-import-dialog__close" aria-label="关闭安装技能" :disabled="store.importing" @click="emit('close')">
          <YjIcon name="dismiss" size="lg" />
        </button>
      </header>
      <button
        ref="dropZone"
        type="button"
        class="skill-import-dialog__file"
        :class="{ 'is-selected': selected, 'is-dragging': dragging }"
        :disabled="!ready || preparing || store.importing"
        :aria-label="selected ? '更换文件 ' + selected.name : '选择技能文件'"
        :aria-describedby="requirementsId"
        @click="choose()"
      >
        <YjIcon class="skill-import-dialog__document" name="file" :stroke-width="0.8" />
        <span class="skill-import-dialog__filename" aria-live="polite">
          {{ preparing ? "正在准备文件…" : selected ? selected.name : "拖放 .zip 或 SKILL.md 文件，或点击选择" }}
        </span>
        <span v-if="selected" class="skill-import-dialog__replace">更换</span>
      </button>
      <div :id="requirementsId" class="skill-import-dialog__requirements">
        <h3>文件要求</h3>
        <ul>
          <li>包含 SKILL.md 文件的 .zip 压缩包</li>
          <li>或直接拖入 SKILL.md 文件</li>
        </ul>
      </div>
      <p v-if="error" class="skill-import-dialog__error" role="alert">{{ error }}</p>
      <footer class="skill-import-dialog__actions">
        <button type="button" class="yj-control yj-control--regular yj-control--pill" :disabled="store.importing" @click="emit('close')">取消</button>
        <button
          type="button"
          class="yj-control yj-control--regular yj-control--pill skill-import-dialog__install"
          :disabled="!selected || preparing || store.importing"
          :aria-busy="store.importing"
          @click="install"
        >{{ store.importing ? "安装中…" : "安装" }}</button>
      </footer>
    </section>
  </NModal>
</template>

<style scoped>
:global(.n-modal-container:has(.skill-import-dialog) .n-modal-mask) {
  background-color: var(--yj-color-skill-import-mask);
}

.skill-import-dialog {
  --dialog-inset: calc(var(--yj-space-6) + var(--yj-space-1));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: min(480px, calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)));
  min-height: min(486px, calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8)));
  max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8));
  gap: var(--yj-space-6);
  padding: var(--yj-space-6) var(--dialog-inset) var(--dialog-inset);
  overflow: auto;
  border-radius: var(--yj-space-5);
  background: var(--yj-color-bg-elevated);
  box-shadow: var(--yj-shadow-modal);
  color: var(--yj-color-text-primary);
  font: var(--yj-font-size-body) / var(--yj-line-height-body) var(--yj-font-family-sans);
}

.skill-import-dialog__header,
.skill-import-dialog__actions {
  display: flex;
  align-items: center;
}
.skill-import-dialog__header { justify-content: space-between; }
.skill-import-dialog__header h2 {
  margin: 0;
  font-size: var(--yj-font-size-section-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
}
.skill-import-dialog button { font-family: inherit; cursor: pointer; }
.skill-import-dialog button:disabled { cursor: default; }
.skill-import-dialog button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
.skill-import-dialog__close {
  display: grid;
  place-items: center;
  width: var(--yj-space-6);
  height: var(--yj-space-6);
  margin-inline-end: calc(-1 * var(--yj-space-1));
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  background: transparent;
  color: var(--yj-color-text-disabled);
}
.skill-import-dialog__close :deep(.yj-icon) { color: inherit; }
.skill-import-dialog__close:hover:enabled { background: var(--yj-color-control-hover); color: var(--yj-color-text-primary); }
.skill-import-dialog__file {
  display: flex;
  flex-direction: column;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 186px;
  gap: var(--yj-space-3);
  padding: var(--yj-space-4);
  border: var(--yj-border-width) dashed color-mix(in srgb, var(--yj-color-border-strong) 65%, var(--yj-color-bg-card));
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-elevated);
  color: var(--yj-color-text-secondary);
  font: inherit;
}
.skill-import-dialog__file.is-selected,
.skill-import-dialog__file:hover:enabled { background: var(--yj-color-control-hover); }
.skill-import-dialog__file.is-dragging {
  border-color: var(--yj-color-focus-ring);
  background: var(--yj-color-control-pressed);
}
.skill-import-dialog__document {
  width: var(--yj-space-12);
  height: var(--yj-space-12);
  color: var(--yj-color-border-strong);
  fill: var(--yj-color-bg-card);
}
.skill-import-dialog__filename { max-width: 100%; overflow-wrap: anywhere; }
.is-selected .skill-import-dialog__filename { color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-medium); }
.skill-import-dialog__replace {
  padding: var(--yj-space-1) var(--yj-space-4);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-control-pressed);
  color: var(--yj-color-text-primary);
  line-height: var(--yj-control-line-height);
}
.skill-import-dialog__requirements h3 { margin: 0; font-size: inherit; font-weight: var(--yj-font-weight-semibold); }
.skill-import-dialog__requirements ul {
  display: grid;
  gap: var(--yj-space-1);
  margin: var(--yj-space-1) 0 0;
  padding-inline-start: var(--yj-space-4);
  color: var(--yj-color-text-secondary);
}
.skill-import-dialog__error { margin: 0; color: var(--yj-color-semantic-error-ink); }
.skill-import-dialog__actions {
  justify-content: flex-end;
  gap: var(--yj-space-3);
  margin-top: auto;
}
.skill-import-dialog__actions button {
  min-width: 88px;
  border: 0;
  background: color-mix(in srgb, var(--yj-color-control-pressed) 65%, var(--yj-color-bg-card));
  color: var(--yj-color-text-primary);
}
.skill-import-dialog__actions button:hover:enabled { background: var(--yj-color-control-pressed); }
.skill-import-dialog__actions .skill-import-dialog__install:enabled {
  background: var(--yj-color-brand-primary);
  color: var(--yj-color-on-brand);
  font-weight: var(--yj-font-weight-semibold);
}
.skill-import-dialog__actions .skill-import-dialog__install:hover:enabled { background: var(--yj-color-brand-hover); }
.skill-import-dialog__actions .skill-import-dialog__install:active:enabled { background: var(--yj-color-brand-active); }
.skill-import-dialog__actions button:disabled { color: var(--yj-color-text-disabled); }
</style>
