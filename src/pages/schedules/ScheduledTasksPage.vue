<script setup lang="ts">
import { computed, inject, nextTick, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { queueScheduleDraftIntent, clearScheduleDraftIntent } from "../../domain/scheduled-draft-intent";
import { NAlert, NButton, NCard, NInput, NModal, NSelect, NSkeleton, NSwitch, NTag, useMessage } from "naive-ui";
import YjIcon from "../../components/yijie/YjIcon.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjTabs from "../../components/yijie/YjTabs.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import ScheduledCardAction from "../../components/schedules/ScheduledCardAction.vue";
import ScheduledRecordDialog from "../../components/schedules/ScheduledRecordDialog.vue";
import ScheduledDeleteDialog from "../../components/schedules/ScheduledDeleteDialog.vue";
import ScheduledPlanForm from "../../components/schedules/ScheduledPlanForm.vue";
import { CHAT_AUTHORITY_RETRY_KEY, CHAT_EXECUTION_PREPARE_KEY } from "../../authorization/chat-authority-recovery";
import { usePermissionStore } from "../../stores/permission.store";
import { ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { PlanDefinition, PlanView } from "../../domain/scheduled-plan.generated";
import type { PlanSummary, RecordDetail, RecordRow } from "../../api/generated/scheduled-task-ipc.gen";
import { pauseReasonLabels, executionError, recordStatus, ruleLabel, scheduleError, stateLabels, stateOptions, targetLabels, timeLabel, executionTimeLabel, durationLabel } from "../../domain/scheduled-task-ui";
import { useScheduledManagement } from "./use-scheduled-management";
import { useScheduledManual } from "./use-scheduled-manual";

const router = useRouter(); const route = useRoute();
// Resolve the live brand token exactly like the Skill install action.
const scheduleSwitchTheme = { railColorActive: "var(--yj-color-brand-primary)" };
const m = useScheduledManagement();
const { tab, search, state, order, planFilter, cards, records, capabilities, cursor, loading, writing, error, notice, pending, receipt, context, canManage } = m;
const permissions = usePermissionStore(); const message = useMessage();
watch(m.success, value => { if (value) message.success(value); });
const recoverAuthority = inject(CHAT_AUTHORITY_RETRY_KEY, async () => false);
const manual = useScheduledManual(m, inject(CHAT_EXECUTION_PREPARE_KEY, async () => false));
const { review: runReview, rerun: rerunReview, intent: runIntent, busy: runningAction, pending: runPending, result: runResult, error: runError, notice: runNotice, canPrepare } = manual;
const runningPlanId = ref<string | null>(null);
watch(manual.startedRunId, value => { if (value) message.success("任务已开始执行", { closable: true }); });
async function runNow(planId: string) {
  if (runningAction.value || runPending.value) return;
  runningPlanId.value = planId;
  try { await manual.runNow(planId); if (runError.value) message.error(executionError(runError.value)); }
  finally { runningPlanId.value = null; }
}
const prepareExecution = inject(CHAT_EXECUTION_PREPARE_KEY, async () => false);
const autoBusy = ref(false); const autoError = ref(false);
const autoPending = computed(() => pending.value?.kind === "enable");
const canPrepareAutomatic = computed(() => canManage.value && permissions.hasCapability("workspace.use"));
async function prepareAutomatic() {
  if (autoBusy.value) return;
  autoBusy.value = true; autoError.value = false;
  try { autoError.value = !await prepareExecution(); await m.refresh(); }
  catch { autoError.value = true; }
  finally { autoBusy.value = false; }
}
async function togglePlan(enabled: boolean, plan: PlanSummary) {
  if (await m.mutate(enabled ? "enable" : "pause", { plan_id: plan.plan_id, expected_revision: plan.revision }) && enabled) await prepareAutomatic();
  else if (error.value) message.error(scheduleError(error.value));
}
const runReturnFocus = ref("");
watch(runReview, value => { if (value) runReturnFocus.value = rerunReview.value ? `schedule-rerun-${rerunReview.value.confirmation.original_run_id}` : `schedule-run-${value.plan.plan_id}`; });
function focusRunCancel() { document.getElementById("schedule-run-cancel")?.focus(); }
const rerunChanges = computed(() => {
  const p = rerunReview.value; if (!p) return [];
  const target = (d: PlanDefinition) => `${targetLabels[d.target.mode]}${d.target.conversation_id ? ` · ${d.target.conversation_id}` : ""}`;
  return [
    { label: "名称", original: p.original.name, current: p.current.name },
    { label: "任务内容", original: p.original.content, current: p.current.content },
    { label: "时间规则", original: ruleLabel(p.original.rule), current: ruleLabel(p.current.rule) },
    { label: "运行目标", original: target(p.original), current: target(p.current) },
  ].filter(v => v.original !== v.current);
});
async function rerunRecord(row: RecordRow) {
  if (row.record.kind !== "run") return;
  recordDetail.value = null;
  await manual.openRerun(row.record.run.run_id);
}
function restoreRunFocus() { document.getElementById(runReturnFocus.value)?.focus(); }
const formOpen = ref(false); const editing = shallowRef<PlanView | null>(null); const form = ref<InstanceType<typeof ScheduledPlanForm>>();
const deleting = shallowRef<PlanSummary | null>(null); const deleteReturnFocus = ref("");
const deleteDisabled = computed(() => !canManage.value || writing.value || autoBusy.value || autoPending.value || runningAction.value || runPending.value);
const recordDetail = shallowRef<RecordDetail | null>(null); const recordName = ref("");
const recordReturnFocus = ref("");
let detailRerunId: string | null = null;
function rerunFromDetail() {
  if (recordDetail.value?.record.kind !== "run") return;
  detailRerunId = recordDetail.value.record.run.run_id;
  recordDetail.value = null;
}
function afterRecordLeave() {
  const id = detailRerunId; detailRerunId = null;
  // Finish the old focus trap before the new confirmation takes focus.
  if (id) void manual.openRerun(id);
  else void nextTick(() => (document.getElementById(recordReturnFocus.value) ?? document.getElementById("scheduled-panel"))?.focus());
  if (route.query.run) void router.replace({ query: { ...route.query, run: undefined } });
}
const planOptions = ref<{ label: string; value: string }[]>([]); const optionsCursor = ref<string>(); const optionsSearch = ref(""); const optionsLoading = ref(false); const optionsError = ref("");
let optionEpoch = 0; let openingEpoch = 0;
const unavailable = computed(() => capabilities.value && !capabilities.value.read.available);
const readOnly = computed(() => capabilities.value?.read.available && !capabilities.value.save.available);
const tabs = [{ key: "plans", label: "定时任务" }, { key: "records", label: "执行记录" }];
const sorts = [{ value: "created_desc", label: "最新优先" }, { value: "created_asc", label: "最早优先" }];
function report(e: unknown) { error.value = e instanceof ScheduledTaskNativeError ? e.code : "protocol_mismatch"; }
async function createThroughConversation() {
  if (!permissions.selectedTenantId || permissions.authorizationRevision === null || !canManage.value) return;
  queueScheduleDraftIntent(permissions.selectedTenantId, permissions.authorizationRevision);
  if (await router.push({ path: "/chat", query: { create: "schedule" } })) clearScheduleDraftIntent();
}
watch([context, () => route.query.plan], async ([bound, id]) => {
  if (!bound || typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return;
  try { const detail = await m.call("schedule_get_plan_v1", { plan_id: id }); if (context.value === bound && route.query.plan === id) { receipt.value = detail; notice.value = "已定位保存的计划，当前状态以下方记录为准。"; } } catch (e) { report(e); }
}, { immediate: true });
function create() { error.value = null; editing.value = null; formOpen.value = true; }
function viewHistory(plan: PlanSummary) {
  search.value = ""; state.value = "all"; planFilter.value = plan.plan_id;
  if (!planOptions.value.some(p => p.value === plan.plan_id)) planOptions.value.unshift({ value: plan.plan_id, label: plan.name });
  tab.value = "records";
  void nextTick(() => document.getElementById("scheduled-panel")?.focus());
}
function cardClick(event: MouseEvent, plan: PlanSummary) {
  if (event.target instanceof Element && event.target.closest("button, a, input, [role=switch]")) return;
  if (canManage.value && !writing.value && !autoBusy.value && !autoPending.value && !runningAction.value && !runPending.value) void edit(plan);
}
function recordId(row: RecordRow) {
  return `schedule-record-${row.record.kind === "run" ? row.record.run.run_id : JSON.stringify(row.record.key)}`;
}
function recordClick(event: MouseEvent, row: RecordRow) {
  if (event.target instanceof Element && event.target.closest("button, a, input")) return;
  void viewRecord(row);
}
watch([context, () => route.query.run], async ([bound, id]) => {
  if (!bound || typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) return;
  const epoch = ++openingEpoch;
  try {
    const result = await m.call("schedule_get_record_v1", { kind: "run", run_id: id });
    if (epoch !== openingEpoch || context.value !== bound || route.query.run !== id) return;
    tab.value = "records"; recordReturnFocus.value = "scheduled-panel"; runError.value = null;
    recordName.value = result.configuration?.name ?? result.record.plan.name; recordDetail.value = result;
  } catch (e) { if (epoch === openingEpoch) report(e); }
}, { immediate: true });

async function edit(plan: PlanSummary) {
  const epoch = ++openingEpoch;
  try { const detail = await m.call("schedule_get_plan_v1", { plan_id: plan.plan_id }); if (epoch === openingEpoch && canManage.value) { editing.value = detail.plan; formOpen.value = true; } }
  catch (e) { report(e); }
}
async function save(definition: PlanDefinition) {
  const current = editing.value;
  if (await m.save({ definition, ...(current ? { plan_id: current.plan_id, expected_revision: current.revision } : {}) })) {
    formOpen.value = false; tab.value = "plans"; search.value = ""; state.value = "all"; planFilter.value = null;
    if (!current) order.value = "created_desc";
    if (receipt.value?.plan.state === "enabled") await prepareAutomatic();
    await m.refresh(); await nextTick();
    const saved = receipt.value?.plan.plan_id;
    if (saved) document.getElementById(`schedule-plan-${saved}`)?.focus();
  }
}
function confirmMutation(plan: PlanSummary) {
  if (deleteDisabled.value) return;
  error.value = null; deleting.value = plan; deleteReturnFocus.value = `schedule-delete-${plan.plan_id}`;
}
async function deletePlan() {
  const plan = deleting.value;
  if (!plan || deleteDisabled.value) return;
  const deleted = await m.mutate("delete", { plan_id: plan.plan_id, expected_revision: plan.revision });
  if (deleting.value === plan && (deleted || pending.value)) deleting.value = null;
}
function restoreDeleteFocus() { (document.getElementById(deleteReturnFocus.value) ?? document.getElementById("scheduled-panel"))?.focus(); }
async function loadOptions(more = false) {
  const epoch = ++optionEpoch; optionsLoading.value = true; optionsError.value = "";
  try {
    const page = await m.call("schedule_list_plans_v1", { include_deleted: true, limit: 30, search: optionsSearch.value, ...(more && optionsCursor.value ? { cursor: optionsCursor.value } : {}) });
    if (epoch !== optionEpoch) return;
    const rows = page.items.map(p => ({ label: p.name, value: p.plan_id }));
    const selected = planOptions.value.find(p => p.value === planFilter.value);
    planOptions.value = more ? [...planOptions.value, ...rows] : rows;
    if (selected && !planOptions.value.some(p => p.value === selected.value)) planOptions.value.unshift(selected);
    optionsCursor.value = page.next_cursor;
  } catch { if (epoch === optionEpoch) optionsError.value = "计划选项读取失败"; }
  finally { if (epoch === optionEpoch) optionsLoading.value = false; }
}
function searchOptions(value: string) { optionsSearch.value = Array.from(value).slice(0,80).join(""); void loadOptions(); }
async function viewRecord(row: RecordRow) {
  runError.value = null;
  recordReturnFocus.value = recordId(row);
  const epoch = ++openingEpoch;
  try { const result = await m.call("schedule_get_record_v1", row.record.key); if (epoch === openingEpoch) { recordDetail.value = result; recordName.value = row.name; } }
  catch (e) { report(e); }
}
async function openConversation(detail: RecordDetail) {
  try {
    // Revalidate the native association in this scope immediately before navigation.
    const current = await m.call("schedule_get_record_v1", detail.record.key);
    if (current.record.kind !== "run" || current.record.conversation.status !== "available") {
      runError.value = "target_unavailable"; return;
    }
    const link = current.record.conversation;
    if (!link.conversation_id || !link.local_turn_id) { runError.value = "target_unavailable"; return; }
    await router.push({ path: `/chat/${link.conversation_id}`, query: { turn: link.local_turn_id } });
  } catch (e) { runError.value = e instanceof ScheduledTaskNativeError ? e.code : "protocol_mismatch"; }
}
async function openRowConversation(row: RecordRow) {
  try { await openConversation(await m.call("schedule_get_record_v1", row.record.key)); } catch (e) { report(e); }
}
watch([context, () => permissions.authorizationRevision], () => {
  openingEpoch++; optionEpoch++; detailRerunId = null; formOpen.value = false; editing.value = null; deleting.value = null; recordDetail.value = null; planOptions.value = []; optionsCursor.value = undefined;
}, { flush: "sync" });
watch(tab, value => { if (value === "records" && context.value && capabilities.value?.read.available) void loadOptions(); });
async function checkReceipt() { await m.queryReceipt(); if (!pending.value) formOpen.value = false; }
async function retryWrite() { if (await m.retryMutation()) formOpen.value = false; }
onBeforeRouteLeave(() => {
  if (pending.value || writing.value || runPending.value || runningAction.value || autoPending.value || autoBusy.value) { notice.value = "请先查证原请求，再离开此页面。"; return false; }
  if (formOpen.value && form.value?.dirty) { form.value.close(); return false; }
  detailRerunId = null;
  return true;
});
</script>
<template>
  <YjPage>
    <div class="schedules-page">
      <YjPageHeader title="定时任务" description="按设定时间自动执行任务，随时开启或关闭。">
        <template #actions><NButton :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click="createThroughConversation">通过对话创建</NButton><NButton type="primary" :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click="create">新建定时任务</NButton></template>
      </YjPageHeader>
      <div class="schedules-controls">
        <YjTabs v-model="tab" class="schedules-tabs" :items="tabs" panel-id="scheduled-panel" aria-label="定时任务页面" />
        <div v-if="context && !unavailable" class="schedules-toolbar" :class="{ 'schedules-toolbar--records': tab === 'records' }">
          <NInput v-model:value="search" clearable :maxlength="80" :placeholder="tab === 'plans' ? '搜索计划名称或内容' : '搜索记录中的名称或内容'" :input-props="{ 'aria-label': '搜索任务名称或内容' }" />
          <NSelect v-model:value="state" :options="stateOptions" aria-label="计划状态筛选" />
          <NSelect v-if="tab === 'plans'" v-model:value="order" :options="sorts" aria-label="创建时间排序" />
          <NSelect v-else v-model:value="planFilter" :options="planOptions" :loading="optionsLoading" clearable filterable remote placeholder="全部任务" :consistent-menu-width="false" :menu-props="{ style: { maxWidth: 'calc(100vw - var(--yj-space-8))' } }" aria-label="按任务筛选" @search="searchOptions" @update:show="value => { if (value) loadOptions(); }" />
        </div>
      </div>
      <NAlert v-if="notice" type="info" role="status" :show-icon="false">{{ notice }}</NAlert>
      <ScheduledDeleteDialog :name="deleting?.name ?? null" :busy="writing" :disabled="deleteDisabled || error === 'revision_conflict' || error === 'not_found'" :error="scheduleError(error)" @cancel="deleting = null" @confirm="deletePlan" @closed="restoreDeleteFocus" />
      <NAlert v-if="pending && !writing" type="warning" title="原请求待查证">
        {{ writing ? '正在处理，请稍候。' : '不要重新创建计划。查证结果只对应原请求，重试也会使用同一请求与原始内容。' }}
        <div class="schedules-actions"><NButton :disabled="!context || writing" @click="checkReceipt">查证原请求</NButton><NButton :disabled="!context || writing" @click="retryWrite">重试同一请求</NButton></div>
      </NAlert>
      <NAlert v-if="runNotice" type="info" role="status">{{ runNotice }}</NAlert>
      <NAlert v-if="runError" type="error" role="alert">{{ executionError(runError) }}</NAlert>
      <NAlert v-if="runPending && !runReview && !runningAction" type="warning" title="本次运行待查证"><NButton :disabled="runningAction || !context" @click="manual.query">查证本次原请求</NButton><NButton :disabled="runningAction || !context" @click="manual.retry">{{ runIntent?.grant && !runIntent.manualAttempted ? '继续本次运行' : '重试本次原请求' }}</NButton></NAlert>
      <NCard v-if="runResult && !manual.direct.value" title="本次运行" size="small" aria-label="本次运行记录"><p>{{ recordStatus(runResult.record) }} · 业务结果尚未评估</p><p class="schedules-meta" v-if="runResult.record.kind === 'run'">运行编号：{{ runResult.record.run.run_id }}</p><div class="schedules-actions"><NButton @click="manual.refreshResult()">刷新运行结果</NButton><NButton @click="recordDetail = runResult; recordName = runResult.configuration?.name ?? '本次运行'">查看本次记录</NButton><NButton :disabled="runResult.record.kind !== 'run' || runResult.record.conversation.status !== 'available'" @click="openConversation(runResult)">查看完整对话</NButton></div></NCard>
      <NAlert v-if="error" type="error" role="alert">{{ scheduleError(error) }} <NButton v-if="!pending" size="small" :disabled="loading" @click="m.refresh()">刷新</NButton></NAlert>
      <YjEmpty v-if="!context" title="管理授权尚未就绪" description="恢复授权后可读取与保存计划。管理页面不需要任务执行服务就绪。" icon="scheduledTask">
        <template #actions><NButton @click="recoverAuthority">恢复授权</NButton></template>
      </YjEmpty>
      <YjEmpty v-else-if="unavailable" title="定时任务管理暂未开放" description="当前环境尚未开放此能力，请在受支持的环境中使用。" icon="scheduledTask" />
      <template v-else>
        <NAlert v-if="readOnly" type="warning">当前为只读状态，可以查看计划和记录，无法修改。</NAlert>
        <div v-if="tab === 'records'" class="schedules-meta">状态筛选按计划当前状态；名称和内容按运行时快照。未执行项标明当前计划参考。
          <NTag v-if="planFilter" closable @close="planFilter = null">{{ planOptions.find(p => p.value === planFilter)?.label ?? '所选任务' }}</NTag>
          <NButton v-if="optionsCursor" size="tiny" :loading="optionsLoading" @click="loadOptions(true)">更多任务选项</NButton><NButton v-if="optionsError" size="tiny" @click="loadOptions()">{{ optionsError }} · 重试</NButton>
        </div>
        <section id="scheduled-panel" role="tabpanel" tabindex="-1" :aria-labelledby="`scheduled-panel-tab-${tab}`" :aria-busy="loading">
          <div v-if="loading && !(tab === 'plans' ? cards.length : records.length)" class="schedules-grid"><NSkeleton v-for="i in 4" :key="i" height="200px" /></div>
          <YjEmpty v-else-if="!(tab === 'plans' ? cards.length : records.length) && !error" class="schedules-empty" :title="search || state !== 'all' || planFilter ? '没有匹配的记录' : tab === 'plans' ? '还没有定时任务' : '还没有执行记录'" :description="tab === 'plans' ? '通过对话或手动设置创建计划，保存后可随时调整。' : '计划保存和未来时间预览不会产生执行记录。'" icon="scheduledTask"><template #actions><NButton v-if="search || state !== 'all' || planFilter" @click="search = ''; state = 'all'; planFilter = null">清空筛选</NButton><NButton v-else-if="tab === 'plans'" type="primary" :disabled="!canManage" @click="create">新建定时任务</NButton></template></YjEmpty>
          <div v-else-if="tab === 'plans'" class="schedules-grid">
            <NCard v-for="card in cards" :key="card.summary.plan_id" class="schedule-card schedule-plan-card" content-style="padding: var(--yj-space-5); display: flex; flex-direction: column" :aria-label="card.summary.name" @click="cardClick($event, card.summary)">
              <div class="schedule-card__heading"><h2><button :id="`schedule-plan-${card.summary.plan_id}`" class="schedule-card__title" :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click.stop="edit(card.summary)" :aria-label="`编辑 ${card.summary.name}`">{{ card.summary.name }}</button></h2><div class="schedule-card__state" @click.stop><NSwitch class="schedule-switch" :theme-overrides="scheduleSwitchTheme" :id="`schedule-enable-${card.summary.plan_id}`" :value="card.summary.effective_state === 'enabled'" :aria-label="`${card.summary.effective_state === 'enabled' ? '关闭' : '开启'} ${card.summary.name}`" :loading="writing && pending?.payload.plan_id === card.summary.plan_id" :disabled="!(writing && pending?.payload.plan_id === card.summary.plan_id) && ((card.summary.effective_state === 'enabled' ? !canManage : !canPrepareAutomatic) || writing || !!pending || autoBusy || autoPending || runningAction || runPending || card.summary.target_state === 'missing')" @update:value="value => togglePlan(value, card.summary)" /></div></div>
              <p class="schedule-card__content">{{ card.content_preview }}</p>
              <div class="schedule-card__footer"><div class="schedule-card__timing">
                <p :title="ruleLabel(card.rule)"><YjIcon name="pending" size="sm" tone="muted" /><span>{{ ruleLabel(card.rule).split(' · ')[0] }}</span></p>
                <p><YjIcon :name="card.summary.effective_state === 'enabled' ? 'arrowRight' : 'stop'" size="sm" tone="muted" /><span>{{ card.summary.effective_state === 'enabled' ? `下次执行 ${timeLabel(card.summary.next_at, card.rule.time_zone)}` : card.summary.pause_reason ? pauseReasonLabels[card.summary.pause_reason] : card.summary.effective_state === 'paused' ? '已关闭' : stateLabels[card.summary.effective_state] }}</span></p>
              </div>
              <div class="schedule-card__actions">
                <ScheduledCardAction icon="taskHistory" label="查看历史记录" @click="viewHistory(card.summary)" />
                <ScheduledCardAction :id="`schedule-run-${card.summary.plan_id}`" icon="run" label="立即执行" :loading="runningAction && runningPlanId === card.summary.plan_id" :disabled="!canPrepare || autoBusy || autoPending || runningAction || runPending || writing || !!pending || card.summary.raw_state === 'deleted' || card.summary.target_state === 'missing'" @click="runNow(card.summary.plan_id)" />
                <ScheduledCardAction :id="`schedule-delete-${card.summary.plan_id}`" icon="trash" label="删除任务" :disabled="deleteDisabled" @click="confirmMutation(card.summary)" />
              </div></div>
            </NCard>
          </div>
          <div v-else class="schedules-records">
            <NCard v-for="row in records" :key="JSON.stringify(row.record.key)" class="schedule-card schedule-record-card" @click="recordClick($event, row)">
              <div class="schedule-card__heading"><h2><button :id="recordId(row)" class="schedule-card__title" :aria-label="`查看 ${row.name} 的执行记录详情`" @click.stop="viewRecord(row)">{{ row.name }}</button></h2><NTag size="small">{{ recordStatus(row.record) }}</NTag></div>
              <p class="schedule-card__content">{{ row.content_preview }}</p>
              <p class="schedules-meta">{{ row.source === 'run_snapshot' ? '运行时快照' : '当前计划参考 · 此项未执行' }} · 计划当前{{ stateLabels[row.record.plan.effective_state] }}</p>
              <p class="schedules-meta">执行时间：{{ executionTimeLabel(row.record.timing) }} · 耗时：{{ durationLabel(row.record.timing) }}</p>
              <p v-if="row.record.kind === 'run'" class="schedules-meta">业务结果尚未评估。聊天关联：{{ row.record.conversation.status === 'available' ? '已关联' : row.record.conversation.status === 'deleted' ? '已删除' : '未知或不可用' }}</p>
              <div class="schedules-actions"><NButton :id="row.record.kind === 'run' ? `schedule-rerun-${row.record.run.run_id}` : undefined" size="small" :disabled="row.record.kind !== 'run' || row.record.plan.raw_state === 'deleted' || row.record.plan.target_state === 'missing' || !canPrepare || autoBusy || autoPending || runningAction || runPending || writing || !!pending" :title="row.record.kind !== 'run' ? '此项未执行，请从当前计划立即运行' : row.record.plan.raw_state === 'deleted' ? '原计划已删除，不能重跑' : row.record.plan.target_state === 'missing' ? '当前运行目标不可用' : '审阅当前配置后创建一次新运行'" @click="rerunRecord(row)">重新执行</NButton><NButton size="small" :disabled="row.record.kind !== 'run' || row.record.conversation.status !== 'available'" @click="openRowConversation(row)">查看对话</NButton></div>
            </NCard>
          </div>
          <div v-if="cursor" class="schedules-more"><NButton :loading="loading" @click="m.refresh(true)">加载更多</NButton></div>
        </section>
      </template>
      <NAlert v-if="capabilities?.automatic.reason === 'runtime_unqualified' && cards.some(c => c.summary.raw_state === 'enabled')" type="warning">本地执行服务尚未就绪，已保存计划暂不能投递。<NButton :disabled="autoBusy || autoPending || runPending || runningAction" @click="prepareAutomatic">重新准备本地执行</NButton></NAlert>
      <NAlert v-if="autoError" type="warning" role="alert">任务已开启，本地执行服务暂未就绪。<NButton :loading="autoBusy" @click="prepareAutomatic">重试准备执行服务</NButton></NAlert>
      <ScheduledPlanForm v-if="formOpen" ref="form" :plan="editing" :busy="writing" :uncertain="!!pending && !writing" :error="scheduleError(error)" :preview="rule => m.call('schedule_preview_time_v1', { rule })" :targets="(search, cursor) => m.call('schedule_list_targets_v1', { search, limit: 30, ...(cursor ? { cursor } : {}) })" @close="formOpen = false" @save="save" @query="checkReceipt" @retry="retryWrite" />
      <NModal :show="!!runReview" @after-enter="focusRunCancel" @after-leave="restoreRunFocus" :mask-closable="!runningAction && !runPending" :close-on-esc="!runningAction && !runPending" @update:show="manual.closeReview"><NCard class="scheduled-record-detail scheduled-run-confirmation" content-style="min-height: 0; display: flex; flex-direction: column; overflow: hidden" :title="rerunReview ? '确认重新执行一次' : '确认运行一次'" role="dialog" aria-modal="true" :aria-label="rerunReview ? '确认重新执行一次' : '确认运行一次'">
        <section class="scheduled-run-body" tabindex="0" aria-label="本次运行配置与差异"><template v-if="runReview"><NAlert v-if="rerunReview" type="info" :show-icon="false">使用当前已保存配置创建一次新运行，保留原记录及其结果。</NAlert><template v-if="rerunReview"><section v-for="change in rerunChanges" :key="change.label" class="scheduled-rerun-change"><h3>{{ change.label }}已变化</h3><p class="schedules-meta">原运行配置</p><p class="scheduled-record-body">{{ change.original }}</p><p class="schedules-meta">本次采用的当前配置</p><p class="scheduled-record-body">{{ change.current }}</p></section><p v-if="!rerunChanges.length">当前配置与原运行快照一致，仍会创建新运行。</p></template><h2>{{ runReview.plan.definition.name }}</h2><p class="schedules-meta">当前版本 {{ runReview.plan.revision }} · 运行于{{ targetLabels[runReview.plan.definition.target.mode] }}</p><p v-if="runReview.plan.definition.target.mode === 'existing_chat'">目标聊天：{{ manual.targetTitle.value || '已选择的聊天' }}<br>使用该聊天的原目录；权限模式固定为 Ask。</p><p v-else>使用应用为计划管理的独立目录；权限模式固定为 Ask。</p><p class="scheduled-record-body">{{ runReview.plan.definition.content }}</p><p>计划当前：{{ stateLabels[runReview.summary.effective_state] }}。{{ runReview.plan.definition.target.mode === 'new_chat_each_run' ? '本次将创建新聊天。' : '沿当前有效聊天关联执行，不恢复已删除的聊天。' }}</p><p v-if="runIntent?.grant">本次许可截止：{{ timeLabel(runIntent.grant.expires_at) }}</p><p>需要审批时，请进入完整对话处理；关闭详情不会停止已开始的任务。</p></template>
        <NAlert v-if="runError" type="error">{{ executionError(runError) }}</NAlert><p v-if="runPending" role="status">{{ runNotice || '正在提交，请稍候。' }}</p></section>
        <template #footer><p v-if="runReview">仅允许本次运行 1 次，许可最长 10 分钟，同时受当前会话授权限制。本次许可不改变计划状态、下一次时间或自动额度。</p><div class="schedules-actions"><NButton id="schedule-run-cancel" autofocus :disabled="runningAction || runPending" @click="manual.closeReview">取消</NButton><NButton v-if="!runPending" type="primary" :loading="runningAction" @click="manual.confirm">确认并运行一次</NButton><template v-else><NButton :disabled="runningAction || !context" @click="manual.query">查证本次原请求</NButton><NButton :disabled="runningAction || !context" @click="manual.retry">{{ runIntent?.grant && !runIntent.manualAttempted ? '继续本次运行' : '重试本次原请求' }}</NButton></template></div></template>
      </NCard></NModal>
      <ScheduledRecordDialog :detail="recordDetail" :name="recordName" :error="executionError(runError)" :rerun-disabled="!canPrepare || !recordDetail || recordDetail.record.plan.raw_state === 'deleted' || recordDetail.record.plan.target_state === 'missing' || runningAction || runPending || autoBusy || autoPending || writing || !!pending" @close="recordDetail = null" @closed="afterRecordLeave" @rerun="rerunFromDetail" @conversation="recordDetail && openConversation(recordDetail)" />
    </div>
  </YjPage>
</template>
<style scoped>
.schedules-page { display: grid; gap: var(--yj-space-5); min-width: 0; }
.schedules-controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-4); }
.schedules-tabs { flex: none; flex-wrap: nowrap; }
.schedules-toolbar { --schedule-last-filter-width: var(--yj-layout-schedule-sort-width); --toolbar-width: calc(var(--yj-layout-schedule-search-width) + var(--yj-layout-schedule-state-width) + var(--schedule-last-filter-width) + var(--yj-space-3) * 2); display: grid; grid-template-columns: minmax(0, var(--yj-layout-schedule-search-width)) var(--yj-layout-schedule-state-width) minmax(0, var(--schedule-last-filter-width)); flex: 1 1 var(--toolbar-width); min-width: 0; max-width: var(--toolbar-width); margin-left: auto; gap: var(--yj-space-3); align-items: center; }
.schedules-toolbar--records { --schedule-last-filter-width: var(--yj-layout-schedule-plan-filter-width); }
.schedules-empty { min-height: var(--yj-layout-schedule-empty-min-height); }
.schedules-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-4); }
.schedules-records { display: grid; gap: var(--yj-space-4); }
.schedule-card { min-width: 0; }
.schedule-record-card { cursor: pointer; }
.schedule-card__state { display: flex; gap: var(--yj-space-2); align-items: center; flex-shrink: 0; }
.schedule-card__title { color: inherit; font: inherit; text-align: left; border: 0; padding: 0; background: transparent; cursor: pointer; overflow-wrap: anywhere; }
.schedule-card__title:disabled { cursor: default; }
.schedule-card__title:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.schedule-card__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-2); opacity: 0; transition: opacity .12s; }
.schedule-plan-card:hover .schedule-card__actions, .schedule-plan-card:focus-within .schedule-card__actions { opacity: 1; }
@media (hover: none) { .schedule-card__actions { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .schedule-card__actions { transition: none; } }
.schedule-card__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--yj-space-3); }
.schedule-card__heading h2 { margin: 0; font-size: var(--yj-font-size-section-title); overflow-wrap: anywhere; }
.schedule-card__content { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.schedule-plan-card .schedule-card__content { color: var(--yj-color-text-secondary); margin: var(--yj-space-3) 0 var(--yj-space-5); min-height: calc(2 * var(--yj-line-height-body)); }
.schedule-plan-card .schedule-card__title { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.schedule-card__footer { display: flex; align-items: flex-end; gap: var(--yj-space-2); margin-top: auto; }
.schedule-card__timing { flex: 1; min-width: 0; color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
.schedule-card__timing p { display: flex; align-items: center; gap: var(--yj-space-2); margin: var(--yj-space-2) 0 0; }
.schedule-card__timing span { overflow-wrap: anywhere; }
.schedule-switch { border: none; padding: 0; background: transparent; }
.schedules-meta { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.schedules-actions { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); margin-top: var(--yj-space-3); }
.schedules-more { display: flex; justify-content: center; padding: var(--yj-space-4); }
.scheduled-record-detail { width: min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-12))); max-height: calc(100vh - var(--yj-space-12)); overflow: auto; }
.scheduled-run-confirmation { overflow: hidden; }
.scheduled-run-body { flex: 1; min-height: 0; overflow: auto; }
.scheduled-run-body:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.scheduled-rerun-change { border-bottom: var(--yj-border-width) solid var(--yj-color-border-default); padding-bottom: var(--yj-space-3); }
.scheduled-record-body { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 900px) { .schedules-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
