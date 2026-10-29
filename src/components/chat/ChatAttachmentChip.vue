<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { NPopover } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import { chatFilePresentation, fileNameParts, type AttachmentPresentation, type AttachmentPresentationReader } from "../../domain/chat-file-presentation";

const props = withDefaults(defineProps<{
  attachmentId: string;
  name: string;
  mediaType: string;
  status: string;
  active?: boolean;
  removable?: boolean;
  disabled?: boolean;
  readPresentation?: AttachmentPresentationReader;
  openPreview?: () => void;
}>(), { active: false, removable: false, disabled: false });
const emit = defineEmits<{ activate: [id: string | null]; remove: [id: string] }>();
const file = computed(() => chatFilePresentation(props.mediaType));
const nameParts = computed(() => fileNameParts(props.name));
const result = shallowRef<AttachmentPresentation | null>(null);
const triggerElement = ref<HTMLElement | null>(null);
const popoverElement = ref<HTMLElement | null>(null);
const state = ref<"idle" | "loading" | "ready" | "error">("idle");
const available = computed(() => Boolean(props.readPresentation) && props.status === "ready" && !props.disabled);
const statusLabel = computed(() => props.status === "expired" ? "已过期" : props.status === "error_terminal" ? "无法读取，请移除后重新选择" : "");
let generation = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
function release() {
  generation++;
  clearTimeout(expiry);
  result.value = null;
  state.value = "idle";
}
async function read() {
  release();
  if (!props.active || !available.value || !props.readPresentation) return;
  const current = generation;
  state.value = "loading";
  try {
    const value = await props.readPresentation(props.attachmentId);
    if (generation !== current || !props.active || !available.value) return;
    const remaining = Math.min(30000, value.expiresAt * 1000 - Date.now());
    if (remaining <= 0 || (file.value.image && !value.imageUrl)) throw new Error("preview_unavailable");
    result.value = value;
    state.value = "ready";
    expiry = setTimeout(() => { release(); emit("activate", null); }, remaining);
  } catch {
    if (generation === current) state.value = "error";
  }
}
watch(() => [props.active, props.attachmentId, available.value] as const, () => { void read(); }, { immediate: true });
onBeforeUnmount(release);
function show(value: boolean) { emit("activate", value && available.value ? props.attachmentId : null); }
function activateOrRead() {
  if (props.openPreview) { props.openPreview(); return; }
  if (props.active) void read();
  else show(true);
}
function closeOutside(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && (triggerElement.value?.contains(next) || popoverElement.value?.contains(next))) return;
  show(false);
}
</script>

<template>
  <NPopover :show="active && available" trigger="hover" placement="top" :show-arrow="false" @update:show="show">
    <template #trigger>
      <span ref="triggerElement" class="chat-file-chip" :class="{ 'chat-file-chip--expired': statusLabel, 'chat-file-chip--removable': removable }" :role="openPreview ? 'button' : undefined" :tabindex="available || openPreview ? 0 : undefined" @click="openPreview?.()" @keydown.space.self.stop.prevent="openPreview?.()" :aria-label="`${name}，${file.label}${statusLabel ? `，${statusLabel}` : ''}`" @focus="show(true)" @focusout="closeOutside" @keydown.esc.stop="show(false)" @keydown.enter.self.stop.prevent="activateOrRead">
        <span class="chat-file-chip__icon" :class="`chat-file-chip__icon--${file.tone}`">
          <YjIcon class="chat-file-chip__type-icon" :name="file.icon" size="sm" />
          <button v-if="removable" class="chat-file-chip__remove" type="button" :disabled="disabled" :aria-label="`移除 ${name}`" @click.stop="emit('remove', attachmentId)" @focus="show(false)"><YjIcon name="dismiss" size="sm" /></button>
        </span>
        <span class="chat-file-chip__name"><span class="chat-file-chip__stem">{{ nameParts.stem }}</span><span class="chat-file-chip__extension">{{ nameParts.extension }}</span></span>
        <span v-if="statusLabel" class="chat-file-chip__status">{{ statusLabel }}</span>
      </span>
    </template>
    <div ref="popoverElement" class="chat-file-chip__popover" :class="{ 'chat-file-chip__popover--image': file.image }" @focusout="closeOutside" @keydown.esc.stop="show(false)">
      <template v-if="file.image">
        <img v-if="state === 'ready' && result?.imageUrl" :src="result.imageUrl" :alt="name" @error="result = null; state = 'error'">
        <span v-else-if="state === 'loading'" role="status">正在加载图片…</span>
        <template v-else><span role="status">暂时无法预览，仍可发送此附件。</span><button type="button" class="chat-file-chip__retry" @click="read">重试预览</button></template>
      </template>
      <template v-else><span v-if="state === 'loading'" role="status">正在读取路径…</span><span v-else>{{ result?.sourcePath ?? '当前草稿来源路径不可用' }}</span></template>
    </div>
  </NPopover>
</template>

<style scoped>
.chat-file-chip { display: inline-flex; align-items: center; gap: var(--yj-space-2); max-width: 100%; min-width: 0; padding: var(--yj-space-1) var(--yj-space-3); border-radius: var(--yj-radius-full); background: var(--yj-color-skill-pill-bg); color: var(--yj-color-text-primary); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); vertical-align: middle; }
.chat-file-chip:not(.chat-file-chip--removable) { background: var(--yj-color-skill-pill-message-bg); }
.chat-file-chip[role="button"] { cursor:pointer; }
.chat-file-chip:focus-visible, .chat-file-chip__remove:focus-visible, .chat-file-chip__retry:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-file-chip__icon { position: relative; display: inline-flex; flex-shrink: 0; color: var(--yj-color-text-secondary); }
.chat-file-chip__icon :deep(.chat-file-chip__type-icon) { color: inherit; }
.chat-file-chip__icon--success { color: var(--yj-color-semantic-success-ink); }
.chat-file-chip__icon--warning { color: var(--yj-color-semantic-warning-ink); }
.chat-file-chip__icon--error { color: var(--yj-color-semantic-error-ink); }
.chat-file-chip__icon--info, .chat-file-chip__icon--brand { color: var(--yj-color-semantic-info-ink); }
.chat-file-chip__name { display: inline-flex; min-width: 0; }
.chat-file-chip__stem { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-file-chip__extension { flex-shrink: 0; }
.chat-file-chip__remove { position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center; border: 0; padding: 0; color: var(--yj-color-text-primary); background: var(--yj-color-skill-pill-bg); opacity: 0; cursor: pointer; }
.chat-file-chip:hover .chat-file-chip__remove, .chat-file-chip:focus-within .chat-file-chip__remove { opacity: 1; }
.chat-file-chip__remove:disabled { cursor: default; }
.chat-file-chip__status { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-file-chip__popover { max-width: min(32rem, 85vw); overflow-wrap: anywhere; color: var(--yj-color-text-primary); }
.chat-file-chip__popover--image { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: var(--yj-space-2); width: min(20rem, 75vw); min-height: var(--yj-space-12); }
.chat-file-chip__popover img { display: block; width: auto; height: auto; max-width: 100%; max-height: 15rem; object-fit: contain; }
.chat-file-chip__retry { color: var(--yj-color-text-primary); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-sm); padding: var(--yj-space-1) var(--yj-space-2); background: var(--yj-color-bg-card); cursor: pointer; }
</style>
