<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { NPopover } from "naive-ui";
import type { AttachmentPresentationReader } from "../../domain/chat-file-presentation";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{
  attachmentId: string;
  name: string;
  status: string;
  scopeKey?: string;
  removable?: boolean;
  disabled?: boolean;
  readPresentation?: AttachmentPresentationReader;
}>(), { removable: false, disabled: false, scopeKey: "" });
const emit = defineEmits<{ remove: [id: string] }>();
const root = ref<HTMLElement>();
const preview = ref<HTMLElement>();
const imageUrl = ref<string | null>(null);
const phase = ref<"idle" | "loading" | "ready" | "error">("idle");
const expanded = ref(false);
const visible = ref(typeof IntersectionObserver === "undefined");
const foreground = ref(document.visibilityState !== "hidden");
const available = computed(() => ["ready", "bound"].includes(props.status) && !props.disabled && Boolean(props.readPresentation));
const wanted = computed(() => available.value && visible.value && foreground.value);
const label = computed(() => props.status === "expired" ? "图片已过期" : props.status === "error_terminal" ? "图片无法读取" : "暂时无法预览");
let observer: IntersectionObserver | undefined;
let expiry: ReturnType<typeof setTimeout> | undefined;
let refresh: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let request: AbortController | undefined;
let expiresAt = 0;

function release() {
  generation++;
  request?.abort();
  clearTimeout(expiry);
  clearTimeout(refresh);
  expiresAt = 0;
  imageUrl.value = null;
  phase.value = "idle";
  expanded.value = false;
}
function scheduleRefresh() {
  clearTimeout(refresh);
  const remaining = expiresAt - Date.now();
  if (wanted.value && imageUrl.value && remaining > 5000) {
    refresh = setTimeout(() => { void read(); }, remaining - 5000);
  }
}
async function read() {
  if (!wanted.value || !props.readPresentation || phase.value === "loading") return;
  const current = ++generation;
  request?.abort();
  request = new AbortController();
  phase.value = "loading";
  try {
    const value = await props.readPresentation(props.attachmentId, request.signal);
    if (current !== generation || !available.value) return;
    const remaining = Math.min(30000, value.expiresAt * 1000 - Date.now());
    if (!value.imageUrl || remaining <= 0) throw new Error("preview_unavailable");
    // Retain only the short-lived image projection, never its source path.
    imageUrl.value = value.imageUrl;
    expiresAt = Date.now() + remaining;
    phase.value = "ready";
    clearTimeout(expiry);
    // Refresh before the lease ends so a visible thumbnail does not blink.
    scheduleRefresh();
    expiry = setTimeout(() => {
      expiresAt = 0;
      imageUrl.value = null;
      if (phase.value !== "loading") { phase.value = "idle"; void read(); }
    }, remaining);
  } catch {
    if (current !== generation) return;
    imageUrl.value = null;
    phase.value = "error";
  }
}
function failed() {
  generation++;
  request?.abort();
  clearTimeout(expiry);
  clearTimeout(refresh);
  expiresAt = 0;
  imageUrl.value = null;
  phase.value = "error";
}
function show(value: boolean) {
  expanded.value = value && wanted.value;
  if (expanded.value && phase.value === "idle") void read();
}
function activate() {
  show(true);
  if (phase.value === "error") void read();
}
function closeOutside(event: FocusEvent) {
  const next = event.relatedTarget;
  if (next instanceof Node && (root.value?.contains(next) || preview.value?.contains(next))) return;
  show(false);
}
function visibilityChanged() { foreground.value = document.visibilityState !== "hidden"; }
// Identity/authorization owns the projection. Scrolling only controls loading
// and renewal; it must not discard an image that still has a valid lease.
watch(() => [props.attachmentId, props.scopeKey, props.readPresentation, available.value] as const, () => {
  release();
  if (wanted.value) void read();
}, { immediate: true });
watch(wanted, value => {
  if (!value) {
    expanded.value = false;
    clearTimeout(refresh);
    return;
  }
  if (!imageUrl.value || expiresAt - Date.now() <= 5000) void read();
  else scheduleRefresh();
});
onMounted(() => {
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(([entry]) => { visible.value = Boolean(entry?.isIntersecting); }, { rootMargin: "256px 0px" });
    if (root.value) observer.observe(root.value);
  }
  document.addEventListener("visibilitychange", visibilityChanged);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener("visibilitychange", visibilityChanged);
  release();
});
</script>

<template>
  <span ref="root" class="chat-attachment-image" :class="{ 'chat-attachment-image--draft': removable }" @focusout="closeOutside" @keydown.esc.stop="show(false)">
    <NPopover :show="expanded && wanted" trigger="hover" placement="bottom-end" :show-arrow="false" :raw="true" :delay="150" :duration="150" style="box-shadow: none" @update:show="show">
      <template #trigger>
        <button class="chat-attachment-image__thumbnail" type="button" :disabled="!available" :aria-label="`${phase === 'error' ? '重试预览' : '预览图片'} ${name}${status === 'expired' ? '，已过期' : ''}`" :aria-expanded="expanded" @focus="show(true)" @click="activate">
          <img v-if="imageUrl" :src="imageUrl" :alt="name" draggable="false" @error="failed">
          <span v-else class="chat-attachment-image__placeholder" :aria-busy="phase === 'loading'">
            <YjIcon name="image" size="md" />
            <template v-if="phase === 'error' || !available"><span>{{ label }}</span><span class="chat-attachment-image__name">{{ name }}</span></template>
          </span>
        </button>
      </template>
      <div ref="preview" class="chat-attachment-image__preview" @focusout="closeOutside" @keydown.esc.stop="show(false)">
        <img v-if="imageUrl" :src="imageUrl" :alt="name" draggable="false" @error="failed">
        <div v-else class="chat-attachment-image__preview-status" role="status">
          <span>{{ phase === 'loading' ? '正在加载图片…' : '暂时无法预览图片' }}</span>
          <button v-if="phase === 'error'" type="button" class="chat-attachment-image__retry" @click="read">重试预览</button>
        </div>
      </div>
    </NPopover>
    <button v-if="removable" class="chat-attachment-image__remove" type="button" :disabled="disabled" :aria-label="`移除 ${name}`" @click.stop="emit('remove', attachmentId)" @focus="show(false)"><YjIcon name="dismiss" size="xs" :stroke-width="1.5" /></button>
  </span>
</template>

<style scoped>
.chat-attachment-image { position: relative; display: inline-flex; flex: 0 0 auto; width: var(--yj-chat-attachment-message-size); height: var(--yj-chat-attachment-message-size); vertical-align: middle; }
.chat-attachment-image--draft { width: var(--yj-chat-attachment-draft-size); height: var(--yj-chat-attachment-draft-size); }
.chat-attachment-image__thumbnail { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 0; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-xl); overflow: hidden; background: var(--yj-color-bg-card); color: var(--yj-color-text-secondary); cursor: pointer; }
.chat-attachment-image__thumbnail:disabled { cursor: default; }
.chat-attachment-image__thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
.chat-attachment-image__placeholder { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: var(--yj-space-1); padding: var(--yj-space-2); font-size: var(--yj-font-size-caption); }
.chat-attachment-image__name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-attachment-image__remove { position: absolute; top: calc(var(--yj-space-1) / 2); right: calc(var(--yj-space-1) / 2); display: flex; align-items: center; justify-content: center; width: var(--yj-space-6); height: var(--yj-space-6); padding: 0; border: 0; border-radius: var(--yj-radius-full); background: transparent; color: var(--yj-color-text-secondary); opacity: 0; cursor: pointer; }
.chat-attachment-image__remove::before { content: ""; position: absolute; inset: calc(var(--yj-space-1) / 2); border-radius: inherit; background: color-mix(in srgb, var(--yj-color-bg-card) 88%, transparent); }
.chat-attachment-image__remove :deep(.yj-icon) { position: relative; }
.chat-attachment-image:hover .chat-attachment-image__remove, .chat-attachment-image:focus-within .chat-attachment-image__remove { opacity: 0.8; }
.chat-attachment-image .chat-attachment-image__remove:hover, .chat-attachment-image .chat-attachment-image__remove:focus-visible { opacity: 1; }
.chat-attachment-image__thumbnail:focus-visible, .chat-attachment-image__remove:focus-visible, .chat-attachment-image__retry:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.chat-attachment-image__preview { display: flex; align-items: center; justify-content: center; width: min(var(--yj-chat-attachment-preview-size), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow: hidden; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-xl); background: var(--yj-color-bg-card); box-shadow: var(--yj-shadow-popover); }
.chat-attachment-image__preview > img { display: block; width: auto; height: auto; max-width: 100%; max-height: min(var(--yj-chat-attachment-preview-size), calc(100vh - var(--yj-space-8))); object-fit: contain; }
.chat-attachment-image__preview-status { display: flex; min-height: var(--yj-space-16); flex-direction: column; align-items: center; justify-content: center; gap: var(--yj-space-2); padding: var(--yj-space-4); color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.chat-attachment-image__retry { padding: var(--yj-space-1) var(--yj-space-2); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-sm); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); cursor: pointer; }
@media (hover: none) { .chat-attachment-image__remove { opacity: 1; } }
</style>
