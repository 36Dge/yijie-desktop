<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NForm, NFormItem, NInput, NModal, NSelect, useDialog } from "naive-ui";
import type { PlanDefinition, PlanView, TimePreview, TimeRule } from "../../domain/scheduled-plan.generated";
import type { TargetPage } from "../../api/generated/scheduled-task-ipc.gen";
import { frequencyLabels, targetLabels, timeLabel } from "../../domain/scheduled-task-ui";
const props = defineProps<{ plan: PlanView | null; initialDefinition?: PlanDefinition; confirmation?: boolean; busy: boolean; uncertain: boolean; error: string; preview: (rule: TimeRule) => Promise<TimePreview>; targets: (search: string, cursor?: string) => Promise<TargetPage> }>();
const emit = defineEmits<{ close: []; query: []; retry: []; save: [definition: PlanDefinition] }>();
const dialog = useDialog();
const initial = props.plan?.definition ?? props.initialDefinition;
const title = computed(() => props.confirmation ? "确认定时任务草案" : props.plan ? "编辑定时任务" : "手动创建定时任务");
const form = reactive({ name: initial?.name ?? "", content: initial?.content ?? "", frequency: initial?.rule.frequency ?? "daily", timeZone: initial?.rule.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, localTime: initial?.rule.local_time ?? "09:00", localDate: initial?.rule.local_date ?? "", weekdays: initial?.rule.weekdays?.slice() ?? [1], mode: initial?.target.mode ?? "dedicated_chat", conversationId: initial?.target.conversation_id ?? null });
const initialJson = JSON.stringify(form);
const dirty = computed(() => JSON.stringify(form) !== initialJson);
const blocked = computed(() => props.busy || props.uncertain);
const rule = computed<TimeRule>(() => ({ frequency: form.frequency, time_zone: form.timeZone.trim(), local_time: form.localTime.trim(), ...(form.frequency === "once" ? { local_date: form.localDate.trim() } : {}), ...(form.frequency === "weekly" ? { weekdays: form.weekdays.slice().sort() } : {}) }));
const previewText = ref("正在计算…"); const previewValid = ref(false); const targetOptions = ref<{ label: string; value: string }[]>([]); const targetCursor = ref<string>(); const targetSearch = ref(""); const targetError = ref(""); const targetLoading = ref(false);
let previewEpoch = 0; let targetEpoch = 0; let alive = true; let previewTimer: ReturnType<typeof setTimeout> | undefined; let targetTimer: ReturnType<typeof setTimeout> | undefined;
const frequencyOptions = Object.entries(frequencyLabels).map(([value,label]) => ({value,label}));
const modeOptions = Object.entries(targetLabels).map(([value,label]) => ({value,label}));
const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];
const valid = computed(() => Array.from(form.name.trim()).length > 0 && Array.from(form.name.trim()).length <= 80 && Array.from(form.content.trim()).length > 0 && Array.from(form.content.trim()).length <= 10000 && previewValid.value && (form.mode !== "existing_chat" || !!form.conversationId));
watch(rule, () => {
  const epoch = ++previewEpoch; previewValid.value = false; previewText.value = "正在计算…";
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const result = await props.preview(rule.value);
      if (!alive || epoch !== previewEpoch) return;
      previewValid.value = result.next_at !== undefined;
      previewText.value = result.next_at === undefined ? "没有未来运行时间，请调整日期或规则。" : `启用后预计：${timeLabel(result.next_at, rule.value.time_zone)}（${rule.value.time_zone}）`;
    } catch { if (alive && epoch === previewEpoch) previewText.value = "无法计算，请检查日期、时间、星期和 IANA 时区。"; }
  }, 250);
}, { immediate: true });
async function loadTargets(more = false) {
  const epoch = ++targetEpoch; targetLoading.value = true; targetError.value = "";
  try {
    const page = await props.targets(targetSearch.value, more ? targetCursor.value : undefined);
    if (!alive || epoch !== targetEpoch) return;
    const rows = page.items.filter(t => t.can_save).map(t => ({ value: t.conversation_id, label: `${t.title}${t.execution === "blocked" ? "（执行条件待确认）" : ""}` }));
    targetOptions.value = more ? [...targetOptions.value, ...rows] : rows; targetCursor.value = page.next_cursor;
  } catch { if (alive && epoch === targetEpoch) targetError.value = "无法读取聊天列表，请重试。"; }
  finally { if (alive && epoch === targetEpoch) targetLoading.value = false; }
}
watch(() => form.mode, mode => { if (mode === "existing_chat") void loadTargets(); }, { immediate: true });
function searchTargets(value: string) { targetSearch.value = value.slice(0,80); targetEpoch++; clearTimeout(targetTimer); targetTimer = setTimeout(() => { void loadTargets(); }, 220); }
function close() {
  if (blocked.value) return;
  if (!dirty.value) { emit("close"); return; }
  dialog.warning({ title: "放弃未保存的修改？", content: "这些修改尚未保存。", positiveText: "放弃修改", negativeText: "继续编辑", onPositiveClick: () => emit("close") });
}
function submit() {
  if (!valid.value || blocked.value) return;
  emit("save", { name: form.name.trim(), content: form.content.trim(), rule: rule.value, target: { mode: form.mode, ...(form.mode === "existing_chat" && form.conversationId ? { conversation_id: form.conversationId } : {}) } });
}
onBeforeUnmount(() => { alive = false; previewEpoch++; targetEpoch++; clearTimeout(previewTimer); clearTimeout(targetTimer); });
defineExpose({ dirty, close });
</script>
<template>
  <NModal :show="true" :mask-closable="false" @update:show="close">
    <NCard class="schedule-form" :title="title" closable role="dialog" aria-modal="true" :aria-label="title" @close="close">
      <NForm label-placement="top" :disabled="blocked" @submit.prevent="submit">
        <NAlert type="info" :show-icon="false">保存后保持暂停。可在管理页另行确认运行一次，或确认有限授权后启用自动运行。</NAlert>
        <NAlert v-if="error" type="error" role="alert">{{ error }}</NAlert>
        <NAlert v-if="uncertain" type="warning">保存结果待查证。<NButton :disabled="busy" @click="emit('query')">查证原请求</NButton><NButton :disabled="busy" @click="emit('retry')">重试同一请求</NButton></NAlert>
        <NFormItem label="名称" required><NInput v-model:value="form.name" placeholder="例如：每日 Amazon 商品巡检" :maxlength="80" show-count :input-props="{ 'aria-label': '计划名称' }" /></NFormItem>
        <NFormItem label="任务内容" required><NInput v-model:value="form.content" type="textarea" placeholder="例如：汇总我提供的公开商品信息，列出价格变化和 Listing 待优化项，并注明数据来源。" :autosize="{ minRows: 3, maxRows: 6 }" :maxlength="10000" show-count :input-props="{ 'aria-label': '任务内容' }" /></NFormItem>
        <div class="schedule-form__grid">
          <NFormItem label="频率" required><NSelect v-model:value="form.frequency" :options="frequencyOptions" aria-label="频率" /></NFormItem>
          <NFormItem label="当地时间（HH:mm）" required><NInput v-model:value="form.localTime" placeholder="09:00" :input-props="{ 'aria-label': '当地时间' }" /></NFormItem>
          <NFormItem v-if="form.frequency === 'once'" label="日期（YYYY-MM-DD）" required><NInput v-model:value="form.localDate" placeholder="2026-10-01" :input-props="{ 'aria-label': '运行日期' }" /></NFormItem>
          <NFormItem label="时区（IANA）" required><NInput v-model:value="form.timeZone" placeholder="Asia/Shanghai" :input-props="{ 'aria-label': '时区' }" /></NFormItem>
        </div>
        <NFormItem v-if="form.frequency === 'weekly'" label="每周运行日" required><NCheckboxGroup v-model:value="form.weekdays" aria-label="每周运行日"><NCheckbox v-for="(label,index) in weekLabels" :key="label" :value="index+1" :label="`周${label}`" /></NCheckboxGroup></NFormItem>
        <p class="schedule-form__hint">运行位置：此设备 · 通知：应用内重要更新</p>
        <p role="status">{{ previewText }}</p>
        <p class="schedule-form__hint">工作日按周一至周五计算。夏令时不存在的时间跳过，重复时间只执行一次。离线期间不补跑。</p>
        <NFormItem label="运行于" required><NSelect v-model:value="form.mode" :options="modeOptions" aria-label="运行于" /></NFormItem>
        <template v-if="form.mode === 'existing_chat'">
          <NFormItem label="已有聊天" required><NSelect v-model:value="form.conversationId" filterable remote :options="targetOptions" :loading="targetLoading" :fallback-option="value => ({ value, label: '当前关联聊天（请核对）' })" placeholder="搜索并选择聊天" aria-label="已有聊天" @search="searchTargets" /></NFormItem>
          <p v-if="plan?.target_state === 'missing'" role="alert">原关联聊天已失效，请选择其他聊天。</p>
          <p v-if="targetError" role="alert">{{ targetError }} <NButton size="small" @click="loadTargets()">重试</NButton></p>
          <NButton v-if="targetCursor" size="small" :loading="targetLoading" @click="loadTargets(true)">更多聊天</NButton>
        </template>
        <p class="schedule-form__hint">专属聊天会持续保存同一计划的结果；每次新建聊天分别保存；已有聊天使用所选聊天及其目录。保存计划不会创建聊天或授权执行。</p>
        <div class="schedule-form__actions"><NButton :disabled="blocked" @click="close">取消</NButton><NButton type="primary" attr-type="submit" :disabled="!valid || blocked" :loading="busy">保存为暂停计划</NButton></div>
      </NForm>
    </NCard>
  </NModal>
</template>
<style scoped>
.schedule-form { width: min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-12))); max-height: calc(100vh - var(--yj-space-12)); overflow: auto; }
.schedule-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-4); }
.schedule-form__hint { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.schedule-form__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-3); padding-top: var(--yj-space-4); }
.schedule-form :deep(.n-alert) { margin-bottom: var(--yj-space-4); }
</style>
