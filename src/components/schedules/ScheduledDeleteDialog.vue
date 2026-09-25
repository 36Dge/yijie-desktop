<script setup lang="ts">
import { NButton, NModal } from "naive-ui";

defineProps<{ name: string | null; busy: boolean; disabled: boolean; error: string }>();
const emit = defineEmits<{ cancel: []; confirm: []; closed: [] }>();
function focusCancel() { document.getElementById("schedule-delete-cancel")?.focus(); }
</script>

<template>
  <NModal :show="name !== null" :mask-closable="!busy" :close-on-esc="!busy" @update:show="show => { if (!show && !busy) emit('cancel'); }" @after-enter="focusCancel" @after-leave="emit('closed')">
    <div class="scheduled-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="schedule-delete-title" aria-describedby="schedule-delete-description" :aria-busy="busy">
      <h2 id="schedule-delete-title">删除定时任务？</h2>
      <p id="schedule-delete-description">确定要删除「{{ name }}」吗？此操作无法撤销。删除后不再自动执行，已有执行对话和运行日志会保留。</p>
      <p v-if="error" class="scheduled-delete-dialog__error" role="alert">{{ error }}</p>
      <div class="scheduled-delete-dialog__actions">
        <NButton id="schedule-delete-cancel" :disabled="busy" @click="emit('cancel')">取消</NButton>
        <NButton type="error" :loading="busy" :disabled="disabled" @click="emit('confirm')">删除</NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.scheduled-delete-dialog { box-sizing: border-box; width: min(var(--yj-layout-permission-confirm-width), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow: auto; padding: var(--yj-space-6); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-xl); background: var(--yj-color-bg-elevated); color: var(--yj-color-text-primary); box-shadow: var(--yj-shadow-modal); }
.scheduled-delete-dialog h2 { margin: 0; font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); font-weight: var(--yj-font-weight-semibold); }
.scheduled-delete-dialog p { margin: var(--yj-space-3) 0 0; color: var(--yj-color-text-body); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); overflow-wrap: anywhere; }
.scheduled-delete-dialog .scheduled-delete-dialog__error { color: var(--yj-color-semantic-error-ink); }
.scheduled-delete-dialog__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-3); margin-top: var(--yj-space-6); }
</style>
