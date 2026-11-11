<script setup lang="ts">
import { computed } from "vue";
import { chatDocumentIcon, fileNameParts } from "../../domain/chat-file-presentation";
import YjIcon from "../yijie/YjIcon.vue";
import YjTooltip from "../yijie/YjTooltip.vue";

const props = defineProps<{
  name: string;
  mediaType: string | null;
  sizeBytes: number | null;
  canSave: boolean;
  saving: boolean;
}>();
defineEmits<{ open: []; save: [] }>();
const icon = computed(() => chatDocumentIcon(props.mediaType ?? ""));
const nameParts = computed(() => fileNameParts(props.name));
const sizeLabel = computed(() => {
  const bytes = props.sizeBytes;
  if (bytes === null) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});
</script>

<template>
  <div class="chat-artifact-document-card" :aria-busy="saving">
    <button class="chat-artifact-document-card__open" type="button" :aria-label="`预览 ${name}`" aria-controls="conversation-file-preview" @click="$emit('open')">
      <span class="chat-artifact-document-card__icon" aria-hidden="true">
        <YjIcon :name="icon" size="xl" />
      </span>
      <span class="chat-artifact-document-card__copy">
        <strong class="chat-artifact-document-card__name"><span>{{ nameParts.stem }}</span><span>{{ nameParts.extension }}</span></strong>
        <span class="chat-artifact-document-card__size">{{ sizeLabel }}</span>
      </span>
    </button>
    <YjTooltip text="另存为">
      <button class="chat-artifact-document-card__save" type="button" aria-label="另存为" :disabled="!canSave || saving" @click.stop="$emit('save')">
        <YjIcon :name="saving ? 'pending' : 'download'" size="sm" :stroke-width="1.5" />
      </button>
    </YjTooltip>
  </div>
</template>

<style scoped>
.chat-artifact-document-card { position: relative; min-width: 0; height: var(--yj-space-16); border-radius: var(--yj-radius-xl); background: var(--yj-color-chat-artifact-bg); }
.chat-artifact-document-card:hover { background: var(--yj-color-chat-artifact-hover); }
.chat-artifact-document-card__open { display: flex; width: 100%; height: 100%; min-width: 0; align-items: center; gap: var(--yj-space-2); padding: var(--yj-space-2) calc(var(--yj-space-12) + var(--yj-space-3)) var(--yj-space-2) var(--yj-space-3); border: 0; border-radius: inherit; background: transparent; color: var(--yj-color-chat-artifact-title); text-align: left; font: inherit; cursor: pointer; }
.chat-artifact-document-card__icon { display: flex; flex: none; align-items: center; justify-content: center; width: var(--yj-size-chat-artifact-icon); height: var(--yj-size-chat-artifact-icon); }
.chat-artifact-document-card__icon :deep(.yj-icon) { width: 100%; height: 100%; }
.chat-artifact-document-card__copy { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.chat-artifact-document-card__name { display: flex; min-width: 0; font-size: var(--yj-font-size-chat-artifact-title); font-weight: var(--yj-font-weight-semibold); line-height: var(--yj-line-height-chat-artifact-title); }
.chat-artifact-document-card__name > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-artifact-document-card__name > :last-child { flex: none; }
.chat-artifact-document-card__size { color: var(--yj-color-chat-artifact-meta); font-size: var(--yj-font-size-chat-artifact-meta); line-height: var(--yj-line-height-chat-artifact-meta); }
.chat-artifact-document-card__save { position: absolute; top: 50%; right: var(--yj-space-3); transform: translateY(-50%); display: inline-flex; align-items: center; justify-content: center; width: var(--yj-space-8); height: var(--yj-space-8); padding: 0; border: 0; border-radius: var(--yj-radius-md); background: transparent; color: var(--yj-color-text-secondary); cursor: pointer; opacity: 0; pointer-events: none; }
.chat-artifact-document-card:hover .chat-artifact-document-card__save,
.chat-artifact-document-card:focus-within .chat-artifact-document-card__save,
.chat-artifact-document-card[aria-busy="true"] .chat-artifact-document-card__save { opacity: 1; pointer-events: auto; }
.chat-artifact-document-card__save:hover:not(:disabled) { background: var(--yj-color-control-pressed); color: var(--yj-color-text-primary); }
.chat-artifact-document-card__save:disabled { color: var(--yj-color-text-disabled); cursor: default; }
.chat-artifact-document-card__open:focus-visible,
.chat-artifact-document-card__save:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
@media (hover: none) { .chat-artifact-document-card__save { opacity: 1; pointer-events: auto; } }
</style>
