<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { NAlert, NButton, NCard, useDialog } from "naive-ui";
import ScheduledPlanForm from "./ScheduledPlanForm.vue";
import type { PlanDefinition } from "../../domain/scheduled-plan.generated";
import { ruleLabel, scheduleError, stateLabels, targetLabels } from "../../domain/scheduled-task-ui";
import type { useScheduledDraft } from "../../pages/schedules/use-scheduled-draft";
const props = defineProps<{ model: ReturnType<typeof useScheduledDraft> }>();
const emit = defineEmits<{ accepted: [conversationId: string]; viewPlan: [planId: string]; recover: [] }>();
const { source, preview, saved, pending, writing, loading, error, notice, capabilities, readable, canConfirm, candidate, initialDefinition } = props.model;
const form = ref<InstanceType<typeof ScheduledPlanForm>>();
const editing = shallowRef<{ definition: PlanDefinition; source: string; digest: string } | null>(null);
const dialog = useDialog();
const clarification = computed(() => preview.value?.status === "needs_clarification" && preview.value.output?.kind === "needs_clarification" ? preview.value.output : null);
function review() {
  if (canConfirm.value && initialDefinition.value && preview.value?.source_digest) editing.value = { definition: structuredClone(initialDefinition.value), source: preview.value.source_id, digest: preview.value.source_digest };
}
async function confirm(definition: PlanDefinition) {
  const current = editing.value;
  if (current && await props.model.confirm(definition, current)) editing.value = null;
}
async function query() {
  if (!readable.value) { emit("recover"); return; }
  const result = await props.model.checkPending();
  if (result && "conversation_id" in result) emit("accepted", result.conversation_id);
  if (result && "plan_id" in result) editing.value = null;
}
async function retry() {
  if (!readable.value) { emit("recover"); return; }
  const result = await props.model.retry();
  if (result && "conversation_id" in result) emit("accepted", result.conversation_id);
  if (result && "plan_id" in result) editing.value = null;
}
function continueOriginal() {
  dialog.warning({ title: "检查并继续原请求？", content: "仅在原生记录证明尚未尝试发送时继续。已尝试或不确定的操作不会重新发送。", negativeText: "取消", positiveText: "检查并继续", onPositiveClick: () => { void props.model.continueSource(); } });
}
async function allowLeave(): Promise<boolean> {
  if (writing.value) return false;
  if (pending.value) return new Promise(resolve => dialog.warning({ title: "离开待查证的草案？", content: "离开不会撤回已提交请求。之后可从原聊天核对来源，不能按同名重新创建。", negativeText: "留在此处", positiveText: "离开", onPositiveClick: () => resolve(true), onNegativeClick: () => resolve(false), onClose: () => resolve(false) }));
  if (editing.value) { form.value?.close(); return false; }
  return true;
}
defineExpose({ allowLeave });
</script>
<template>
  <NCard size="small" class="scheduled-draft-panel" aria-label="定时任务草案">
    <p class="scheduled-draft-panel__intro">创建定时任务草案，确认后才会保存。这里只理解你输入的文本，不执行任务。</p>
    <NAlert v-if="error" type="error" role="alert">{{ scheduleError(error) }}</NAlert>
    <p v-if="notice" role="status">{{ notice }}</p>
    <NAlert v-if="!readable" type="warning">草案授权尚未就绪。<NButton @click="emit('recover')">恢复授权</NButton></NAlert>
    <NAlert v-else-if="capabilities && !capabilities.draft.available" type="warning">当前无法生成草案，请恢复任务执行服务后刷新。已有来源仍可查证。<NButton @click="emit('recover')">恢复服务</NButton></NAlert>
    <div v-if="pending" class="scheduled-draft-panel__actions">
      <span role="status">{{ writing ? '正在提交…' : '原请求结果待查证，尚未重新发送。' }}</span>
      <NButton :disabled="writing || !readable" @click="query">查证原请求</NButton>
      <NButton :disabled="writing || !readable" @click="retry">重试同一请求</NButton>
    </div>
    <template v-if="clarification"><strong>请补充信息</strong><p>{{ clarification.question }}</p></template>
    <template v-else-if="candidate">
      <h2 class="scheduled-draft-panel__title">{{ candidate.name }}</h2>
      <p class="scheduled-draft-panel__content">{{ candidate.content }}</p>
      <p>{{ ruleLabel(candidate.schedule) }} · {{ targetLabels[candidate.target.mode] }}</p>
      <p v-if="candidate.target.existing_chat_label">建议聊天：{{ candidate.target.existing_chat_label }}。确认时需要选择实际聊天。</p>
      <NButton type="primary" :disabled="!canConfirm" @click="review">审阅并保存</NButton>
    </template>
    <template v-else-if="saved"><p role="status">{{ saved.definition.name }} · {{ stateLabels[saved.state] }}</p><NButton @click="emit('viewPlan', saved.plan_id)">查看定时任务</NButton></template>
    <template v-else-if="source"><p role="status">尚无可确认的草案结果。当前执行状态见原对话；刷新不会重新发送。</p><NButton :disabled="writing || !!pending || !capabilities?.draft.available" @click="continueOriginal">检查并继续原请求</NButton></template>
    <div class="scheduled-draft-panel__actions"><NButton :loading="loading" :disabled="!readable || writing" @click="model.refresh">刷新草案状态</NButton></div>
    <ScheduledPlanForm v-if="editing" ref="form" :plan="null" :initial-definition="editing.definition" confirmation :busy="writing" :uncertain="!!pending" :error="error ? scheduleError(error) : ''" :preview="model.previewTime" :targets="model.targets" @close="editing = null" @save="confirm" @query="query" @retry="retry" />
  </NCard>
</template>
<style scoped>
.scheduled-draft-panel { margin-block: var(--yj-space-3); max-height: 32vh; overflow: auto; }
.scheduled-draft-panel__intro { color: var(--yj-color-text-secondary); }
.scheduled-draft-panel__title { margin: var(--yj-space-2) var(--yj-space-0); font-size: var(--yj-font-size-body); overflow-wrap: anywhere; }
.scheduled-draft-panel__content { white-space: pre-wrap; overflow-wrap: anywhere; }
.scheduled-draft-panel__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-2); margin-top: var(--yj-space-3); }
</style>
