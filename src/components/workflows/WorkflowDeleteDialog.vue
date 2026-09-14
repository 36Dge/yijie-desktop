<script setup lang="ts">
import { NButton, NCard, NModal } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import type { WorkflowNativeError, WorkflowSummary } from "../../api/workflow-native-client";
defineProps<{ target: WorkflowSummary | null; busy: boolean; uncertain: boolean; error: WorkflowNativeError | null }>();
const emit = defineEmits<{ cancel: []; confirm: []; closed: [] }>();
</script>
<template>
  <NModal :show="!!target" :mask-closable="false" :close-on-esc="!busy && !uncertain" @esc="emit('cancel')" @after-leave="emit('closed')">
    <NCard :bordered="false" role="alertdialog" aria-modal="true" aria-labelledby="workflow-delete-title" aria-describedby="workflow-delete-description" class="workflow-delete-dialog">
      <div class="workflow-delete-dialog__header">
        <h2 id="workflow-delete-title">删除工作流</h2>
        <NButton quaternary circle aria-label="关闭删除提示" :disabled="busy || uncertain" @click="emit('cancel')"><YjIcon name="dismiss" size="sm" /></NButton>
      </div>
      <p id="workflow-delete-description">确定删除“<strong>{{ target?.name }}</strong>”吗？删除后，该工作流将从“我的工作流”中移除，无法继续打开或运行。</p>
      <p v-if="uncertain" role="status">删除结果尚未确认，请重试确认。</p>
      <p v-else-if="error" role="alert" class="workflow-delete-dialog__error">{{ error.code === 'revision_conflict' ? '工作流已更新，请取消并刷新列表后重新确认。' : error.code === 'run_busy' ? '该工作流仍在运行，请结束后再删除。' : error.message }}</p>
      <p v-if="busy" role="status">正在确认删除结果…</p>
      <div class="workflow-delete-dialog__actions">
        <NButton :disabled="busy || uncertain" @click="emit('cancel')">取消</NButton>
        <NButton type="error" :loading="busy" :disabled="!uncertain && (error?.code === 'revision_conflict' || error?.code === 'resource_not_found')" @click="emit('confirm')">{{ uncertain ? '重试确认删除' : '删除工作流' }}</NButton>
      </div>
    </NCard>
  </NModal>
</template>
<style>
.workflow-delete-dialog { width: min(var(--yj-layout-workflow-create-width), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow: auto; }
</style>
<style scoped>
.workflow-delete-dialog__header { display: flex; justify-content: space-between; align-items: center; gap: var(--yj-space-4); }
.workflow-delete-dialog__header h2 { margin: 0; font-size: var(--yj-font-size-section-title); }
.workflow-delete-dialog p { margin-block: var(--yj-space-4); overflow-wrap: anywhere; }
.workflow-delete-dialog__error { color: var(--yj-color-semantic-error-ink); }
.workflow-delete-dialog__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-3); margin-top: var(--yj-space-6); }
</style>
