<script setup lang="ts">
import { computed, inject, nextTick, ref, shallowRef, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import { queueScheduleDraftIntent, clearScheduleDraftIntent } from "../../domain/scheduled-draft-intent";
import { NAlert, NButton, NCard, NInput, NInputNumber, NDatePicker, NForm, NFormItem, NModal, NSelect, NSkeleton, NSwitch, NTag, useDialog } from "naive-ui";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjTabs from "../../components/yijie/YjTabs.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import ScheduledCardAction from "../../components/schedules/ScheduledCardAction.vue";
import ScheduledPlanForm from "../../components/schedules/ScheduledPlanForm.vue";
import { CHAT_AUTHORITY_RETRY_KEY, CHAT_EXECUTION_PREPARE_KEY } from "../../authorization/chat-authority-recovery";
import { usePermissionStore } from "../../stores/permission.store";
import { ScheduledTaskNativeError } from "../../api/scheduled-task-native-client";
import type { PlanDefinition, PlanView } from "../../domain/scheduled-plan.generated";
import type { PlanSummary, RecordDetail, RecordRow } from "../../api/generated/scheduled-task-ipc.gen";
import { pauseReasonLabels, executionError, recordStatus, ruleLabel, scheduleError, stateLabels, stateOptions, targetLabels, timeLabel, executionTimeLabel, durationLabel, timingNote } from "../../domain/scheduled-task-ui";
import { useScheduledManagement } from "./use-scheduled-management";
import { useScheduledManual } from "./use-scheduled-manual";
import { useScheduledAutomatic } from "./use-scheduled-automatic";

const router = useRouter(); const route = useRoute();
const m = useScheduledManagement();
const { tab, search, state, order, planFilter, cards, records, capabilities, cursor, loading, writing, error, notice, pending, receipt, context, canManage } = m;
const permissions = usePermissionStore(); const dialog = useDialog();
const recoverAuthority = inject(CHAT_AUTHORITY_RETRY_KEY, async () => false);
const manual = useScheduledManual(m, inject(CHAT_EXECUTION_PREPARE_KEY, async () => false));
const { review: runReview, rerun: rerunReview, intent: runIntent, busy: runningAction, pending: runPending, result: runResult, error: runError, notice: runNotice, canPrepare } = manual;
const automatic = useScheduledAutomatic(m, inject(CHAT_EXECUTION_PREPARE_KEY, async () => false));
const { review: autoReview, pending: autoPending, busy: autoBusy, error: autoError, notice: autoNotice, maxRuns, expiresMs, nextAt, valid: autoValid, canPrepare: canPrepareAutomatic } = automatic;
const autoReturnFocus = ref("");
watch(autoReview, value => { if (value) autoReturnFocus.value = value.plan.plan_id; });
function focusAutomaticCancel() { document.getElementById("schedule-auto-cancel")?.focus(); }
function restoreAutoFocus() { document.getElementById(`schedule-enable-${autoReturnFocus.value}`)?.focus(); }
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
  else void nextTick(() => document.getElementById(recordReturnFocus.value)?.focus());
  if (route.query.run) void router.replace({ query: { ...route.query, run: undefined } });
}
const planOptions = ref<{ label: string; value: string }[]>([]); const optionsCursor = ref<string>(); const optionsSearch = ref(""); const optionsLoading = ref(false); const optionsError = ref("");
let optionEpoch = 0; let openingEpoch = 0;
const unavailable = computed(() => capabilities.value && !capabilities.value.read.available);
const readOnly = computed(() => capabilities.value?.read.available && !capabilities.value.save.available);
const tabs = [{ key: "plans", label: "定时任务" }, { key: "records", label: "执行记录" }];
const sorts = [{ value: "created_desc", label: "创建时间：最新优先" }, { value: "created_asc", label: "创建时间：最早优先" }];
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
    tab.value = "records"; recordReturnFocus.value = "scheduled-panel";
    recordName.value = result.configuration?.name ?? "执行记录"; recordDetail.value = result;
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
    await m.refresh(); await nextTick();
    const saved = receipt.value?.plan.plan_id;
    if (saved) document.getElementById(`schedule-plan-${saved}`)?.focus();
  }
}
function confirmMutation(kind: "pause" | "delete", plan: PlanSummary) {
  dialog.warning({ title: kind === "delete" ? `删除「${plan.name}」？` : `暂停「${plan.name}」？`, content: kind === "delete" ? "停止后续计划并保留历史。仍在运行、等待审批或状态不确定的任务不能删除。" : "暂停后不再触发未来运行；已开始的任务不会因此停止。", negativeText: "取消", positiveText: kind === "delete" ? "确认删除" : "确认暂停", onPositiveClick: () => { void m.mutate(kind, { plan_id: plan.plan_id, expected_revision: plan.revision }); } });
}
async function loadOptions(more = false) {
  const epoch = ++optionEpoch; optionsLoading.value = true; optionsError.value = "";
  try {
    const page = await m.call("schedule_list_plans_v1", { include_deleted: true, limit: 30, search: optionsSearch.value, ...(more && optionsCursor.value ? { cursor: optionsCursor.value } : {}) });
    if (epoch !== optionEpoch) return;
    const rows = page.items.map(p => ({ label: `${p.name}${p.raw_state === "deleted" ? "（已删除）" : ""} · ${p.plan_id.slice(-8)}`, value: p.plan_id }));
    const selected = planOptions.value.find(p => p.value === planFilter.value);
    planOptions.value = more ? [...planOptions.value, ...rows] : rows;
    if (selected && !planOptions.value.some(p => p.value === selected.value)) planOptions.value.unshift(selected);
    optionsCursor.value = page.next_cursor;
  } catch { if (epoch === optionEpoch) optionsError.value = "计划选项读取失败"; }
  finally { if (epoch === optionEpoch) optionsLoading.value = false; }
}
function searchOptions(value: string) { optionsSearch.value = Array.from(value).slice(0,80).join(""); void loadOptions(); }
async function viewRecord(row: RecordRow) {
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
  openingEpoch++; optionEpoch++; detailRerunId = null; formOpen.value = false; editing.value = null; recordDetail.value = null; planOptions.value = []; optionsCursor.value = undefined;
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
      <YjPageHeader title="定时任务" description="管理重复任务与运行记录。保存的计划保持暂停。">
        <template #actions><NButton :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click="createThroughConversation">通过对话创建</NButton><NButton type="primary" :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click="create">新建定时任务</NButton></template>
      </YjPageHeader>
      <YjTabs v-model="tab" :items="tabs" panel-id="scheduled-panel" aria-label="定时任务页面" />
      <NAlert v-if="notice" type="info" role="status" :show-icon="false">{{ notice }}</NAlert>
      <NCard v-if="receipt && notice" size="small" aria-label="已查证的计划"><strong>{{ receipt.plan.definition.name }}</strong> · {{ stateLabels[receipt.plan.state] }}<p class="schedules-meta">当前版本 {{ receipt.plan.revision }} · {{ targetLabels[receipt.plan.definition.target.mode] }}</p></NCard>
      <NAlert v-if="pending" type="warning" title="原请求待查证">
        {{ writing ? '正在处理，请稍候。' : '不要重新创建计划。查证结果只对应原请求，重试也会使用同一请求与原始内容。' }}
        <div class="schedules-actions"><NButton :disabled="!context || writing" @click="checkReceipt">查证原请求</NButton><NButton :disabled="!context || writing" @click="retryWrite">重试同一请求</NButton></div>
      </NAlert>
      <NAlert v-if="runNotice" type="info" role="status">{{ runNotice }}</NAlert>
      <NAlert v-if="runError" type="error" role="alert">{{ executionError(runError) }}</NAlert>
      <NAlert v-if="runPending && !runReview" type="warning" title="本次运行待查证"><NButton :disabled="runningAction || !context" @click="manual.query">查证本次原请求</NButton><NButton :disabled="runningAction || !context" @click="manual.retry">{{ runIntent?.grant && !runIntent.manualAttempted ? '继续本次运行' : '重试本次原请求' }}</NButton></NAlert>
      <NCard v-if="runResult" title="本次运行" size="small" aria-label="本次运行记录"><p>{{ recordStatus(runResult.record) }} · 业务结果尚未评估</p><p class="schedules-meta" v-if="runResult.record.kind === 'run'">运行编号：{{ runResult.record.run.run_id }}</p><div class="schedules-actions"><NButton @click="manual.refreshResult()">刷新运行结果</NButton><NButton @click="recordDetail = runResult; recordName = runResult.configuration?.name ?? '本次运行'">查看本次记录</NButton><NButton :disabled="runResult.record.kind !== 'run' || runResult.record.conversation.status !== 'available'" @click="openConversation(runResult)">查看完整对话</NButton></div></NCard>
      <NAlert v-if="error" type="error" role="alert">{{ scheduleError(error) }} <NButton v-if="!pending" size="small" :disabled="loading" @click="m.refresh()">刷新</NButton></NAlert>
      <YjEmpty v-if="!context" title="管理授权尚未就绪" description="恢复授权后可读取与保存计划。管理页面不需要任务执行服务就绪。" icon="scheduledTask">
        <template #actions><NButton @click="recoverAuthority">恢复授权</NButton></template>
      </YjEmpty>
      <YjEmpty v-else-if="unavailable" title="定时任务管理暂未开放" description="当前环境尚未开放此能力，请在受支持的环境中使用。" icon="scheduledTask" />
      <template v-else>
        <NAlert v-if="readOnly" type="warning">当前为只读状态，可以查看计划和记录，无法修改。</NAlert>
        <div class="schedules-toolbar">
          <NInput v-model:value="search" clearable :maxlength="80" :placeholder="tab === 'plans' ? '搜索计划名称或内容' : '搜索记录中的名称或内容'" :input-props="{ 'aria-label': '搜索任务名称或内容' }" />
          <NSelect v-model:value="state" :options="stateOptions" aria-label="计划状态筛选" />
          <NSelect v-if="tab === 'plans'" v-model:value="order" :options="sorts" aria-label="创建时间排序" />
          <NSelect v-else v-model:value="planFilter" :options="planOptions" :loading="optionsLoading" clearable filterable remote placeholder="全部任务（含已删除）" aria-label="按任务筛选" @search="searchOptions" @update:show="value => { if (value) loadOptions(); }" />
          <NButton :loading="loading" @click="m.refresh()">刷新</NButton>
        </div>
        <div v-if="tab === 'records'" class="schedules-meta">状态筛选按计划当前状态；名称和内容按运行时快照。未执行项标明当前计划参考。
          <NTag v-if="planFilter" closable @close="planFilter = null">{{ planOptions.find(p => p.value === planFilter)?.label ?? '所选任务' }}</NTag>
          <NButton v-if="optionsCursor" size="tiny" :loading="optionsLoading" @click="loadOptions(true)">更多任务选项</NButton><NButton v-if="optionsError" size="tiny" @click="loadOptions()">{{ optionsError }} · 重试</NButton>
        </div>
        <section id="scheduled-panel" role="tabpanel" tabindex="-1" :aria-labelledby="`scheduled-panel-tab-${tab}`" :aria-busy="loading">
          <div v-if="loading && !(tab === 'plans' ? cards.length : records.length)" class="schedules-grid"><NSkeleton v-for="i in 4" :key="i" height="200px" /></div>
          <YjEmpty v-else-if="!(tab === 'plans' ? cards.length : records.length) && !error" :title="search || state !== 'all' || planFilter ? '没有匹配的记录' : tab === 'plans' ? '还没有定时任务' : '还没有执行记录'"  :description="tab === 'plans' ? '通过对话或手动设置创建计划，保存后可随时调整。' : '计划保存和未来时间预览不会产生执行记录。'" icon="scheduledTask"><template #actions><NButton v-if="search || state !== 'all' || planFilter" @click="search = ''; state = 'all'; planFilter = null">清空筛选</NButton><NButton v-else-if="tab === 'plans'" type="primary" :disabled="!canManage" @click="create">新建定时任务</NButton></template></YjEmpty>
          <div v-else-if="tab === 'plans'" class="schedules-grid">
            <NCard v-for="card in cards" :key="card.summary.plan_id" class="schedule-card schedule-plan-card" :aria-label="card.summary.name" @click="cardClick($event, card.summary)">
              <div class="schedule-card__heading"><h2><button :id="`schedule-plan-${card.summary.plan_id}`" class="schedule-card__title" :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click.stop="edit(card.summary)" :aria-label="`编辑 ${card.summary.name}`">{{ card.summary.name }}</button></h2><div class="schedule-card__state" @click.stop><NTag size="small">{{ stateLabels[card.summary.effective_state] }}</NTag><NSwitch :id="`schedule-enable-${card.summary.plan_id}`" :value="card.summary.effective_state === 'enabled'" :aria-label="`${card.summary.effective_state === 'enabled' ? '暂停' : '启用'} ${card.summary.name}`" :disabled="(card.summary.effective_state === 'enabled' ? !canManage : !canPrepareAutomatic) || writing || !!pending || autoBusy || autoPending || runningAction || runPending || card.summary.target_state === 'missing'" @update:value="value => value ? automatic.open(card.summary.plan_id) : confirmMutation('pause', card.summary)" /></div></div>
              <p class="schedule-card__content">{{ card.content_preview }}</p>
              <p>{{ ruleLabel(card.rule) }}</p>
              <p class="schedules-meta">运行于：{{ targetLabels[card.summary.target_mode] }}<span v-if="card.target_title"> · {{ card.target_title }}</span><span v-if="card.summary.target_state === 'missing'"> · 关联已失效</span></p>
              <p class="schedules-meta">创建时间：{{ timeLabel(card.created_at) }}</p>
              <p class="schedules-meta">{{ card.summary.effective_state === 'enabled' ? '下次运行' : '启用后预计' }}：{{ card.summary.next_at ? timeLabel(card.summary.next_at, card.rule.time_zone) : '无未来时间' }}</p>
              <p v-if="card.summary.pause_reason" class="schedules-meta">{{ pauseReasonLabels[card.summary.pause_reason] }}</p>
              <div class="schedule-card__actions">
                <ScheduledCardAction icon="taskHistory" label="查看历史记录" @click="viewHistory(card.summary)" />
                <ScheduledCardAction :id="`schedule-run-${card.summary.plan_id}`" icon="run" label="立即执行" :disabled="!canPrepare || autoBusy || autoPending || runningAction || runPending || writing || !!pending || card.summary.raw_state === 'deleted' || card.summary.target_state === 'missing'" @click="manual.open(card.summary.plan_id)" />
                <ScheduledCardAction icon="trash" label="删除任务" :disabled="!canManage || writing || autoBusy || autoPending || runningAction || runPending" @click="confirmMutation('delete', card.summary)" />
              </div>
            </NCard>
          </div>
          <div v-else class="schedules-records">
            <NCard v-for="row in records" :key="JSON.stringify(row.record.key)" class="schedule-card" @click="recordClick($event, row)">
              <div class="schedule-card__heading"><h2>{{ row.name }}</h2><NTag size="small">{{ recordStatus(row.record) }}</NTag></div>
              <p class="schedule-card__content">{{ row.content_preview }}</p>
              <p class="schedules-meta">{{ row.source === 'run_snapshot' ? '运行时快照' : '当前计划参考 · 此项未执行' }} · 计划当前{{ stateLabels[row.record.plan.effective_state] }}</p>
              <p class="schedules-meta">执行时间：{{ executionTimeLabel(row.record.timing) }} · 耗时：{{ durationLabel(row.record.timing) }}</p>
              <p v-if="row.record.kind === 'run'" class="schedules-meta">业务结果尚未评估。聊天关联：{{ row.record.conversation.status === 'available' ? '已关联' : row.record.conversation.status === 'deleted' ? '已删除' : '未知或不可用' }}</p>
              <div class="schedules-actions"><NButton :id="recordId(row)" size="small" @click.stop="viewRecord(row)">查看记录</NButton><NButton :id="row.record.kind === 'run' ? `schedule-rerun-${row.record.run.run_id}` : undefined" size="small" :disabled="row.record.kind !== 'run' || row.record.plan.raw_state === 'deleted' || row.record.plan.target_state === 'missing' || !canPrepare || autoBusy || autoPending || runningAction || runPending || writing || !!pending" :title="row.record.kind !== 'run' ? '此项未执行，请从当前计划立即运行' : row.record.plan.raw_state === 'deleted' ? '原计划已删除，不能重跑' : row.record.plan.target_state === 'missing' ? '当前运行目标不可用' : '审阅当前配置后创建一次新运行'" @click="rerunRecord(row)">重新执行</NButton><NButton size="small" :disabled="row.record.kind !== 'run' || row.record.conversation.status !== 'available'" @click="openRowConversation(row)">查看对话</NButton></div>
            </NCard>
          </div>
          <div v-if="cursor" class="schedules-more"><NButton :loading="loading" @click="m.refresh(true)">加载更多</NButton></div>
        </section>
        <p class="schedules-meta">计划保存后保持暂停；另行确认有限次数与期限后可自动运行。只在易界运行且电脑清醒时执行，退出或睡眠期间不补跑。立即运行或重新执行均需单独确认一次许可，不替换自动授权。</p>
      </template>
      <NAlert v-if="capabilities?.automatic.reason === 'runtime_unqualified' && cards.some(c => c.summary.raw_state === 'enabled')" type="warning">本地执行服务尚未就绪，已保存计划暂不能投递。<NButton :disabled="autoBusy || autoPending || runPending || runningAction" @click="automatic.prepareService">重新准备本地执行</NButton></NAlert>
      <NAlert v-if="autoError || autoNotice || autoPending" :type="autoError ? 'warning' : 'info'" role="status"><p v-if="autoError">{{ autoError === 'revision_conflict' ? '计划或下一次运行时间已变化，请重新审阅。' : executionError(autoError) }}</p><p>{{ autoNotice }}</p><template v-if="autoPending"><NButton :disabled="autoBusy || !context" @click="automatic.query">查证原启用请求</NButton><NButton :disabled="autoBusy || !context" @click="automatic.retry">重试原启用请求</NButton></template></NAlert>
      <NModal :show="!!autoReview" @after-enter="focusAutomaticCancel" @after-leave="restoreAutoFocus" :mask-closable="!autoBusy && !autoPending" :close-on-esc="!autoBusy && !autoPending" @update:show="automatic.close"><NCard class="scheduled-record-detail" title="确认自动运行" role="dialog" aria-modal="true" aria-label="确认自动运行">
        <template v-if="autoReview"><h2>{{ autoReview.plan.definition.name }}</h2><p class="schedules-meta">当前版本 {{ autoReview.plan.revision }} · {{ ruleLabel(autoReview.plan.definition.rule) }}</p><p>运行于：{{ targetLabels[autoReview.plan.definition.target.mode] }}<span v-if="automatic.targetTitle.value"> · {{ automatic.targetTitle.value }}</span> · Ask</p><p>{{ autoReview.plan.definition.target.mode === 'existing_chat' ? '沿用已有聊天的原目录。' : '使用应用为计划管理的独立目录。' }}</p><p class="scheduled-record-body">{{ autoReview.plan.definition.content }}</p><p>下一次预计：{{ timeLabel(nextAt, autoReview.plan.definition.rule.time_zone) }}</p><p v-if="autoReview.grant">原授权：最多 {{ autoReview.grant.max_runs }} 次，已占用 {{ autoReview.grant.occupied_runs }} 次；截止 {{ timeLabel(autoReview.grant.expires_at) }}。新确认将替换未来授权。</p>
        <NForm label-placement="top" :disabled="autoBusy || autoPending" @submit.prevent="automatic.confirm"><NFormItem label="最多运行次数"><NInputNumber :input-props="{ 'aria-label': '最多运行次数' }" placeholder="请输入次数" v-model:value="maxRuns" :min="1" :max="2147483647" :precision="0" aria-label="最多运行次数" /></NFormItem><NFormItem label="授权截止时间（设备时区）"><NDatePicker placeholder="请选择截止时间" v-model:value="expiresMs" type="datetime" :clearable="false" aria-label="授权截止时间" /></NFormItem></NForm><p>截止：{{ expiresMs === null ? '请选择' : timeLabel(Math.floor(expiresMs / 1000)) }}（{{ Intl.DateTimeFormat().resolvedOptions().timeZone }}）</p><p>到次数或截止时间先到者为止。次数是运行上限，并非模型请求或费用上限。默认截止为下一次运行后10分钟，可调整。</p><p>易界运行且电脑清醒时才执行；退出或睡眠不补跑。需要审批时进入原对话处理，关闭确认框不停止已开始的任务。</p></template>
        <NAlert v-if="autoError" type="error">{{ autoError === 'revision_conflict' ? '计划或下一次时间已变化，请重新审阅。' : executionError(autoError) }}</NAlert>
        <p v-if="autoPending" role="status">{{ autoNotice || '正在提交自动授权…' }}</p><div class="schedules-actions"><NButton id="schedule-auto-cancel" autofocus :disabled="autoBusy || autoPending" @click="automatic.close">取消</NButton><NButton v-if="!autoPending" type="primary" :disabled="!autoValid" :loading="autoBusy" @click="automatic.confirm">确认并启用</NButton><template v-else><NButton :disabled="autoBusy || !context" @click="automatic.query">查证原启用请求</NButton><NButton :disabled="autoBusy || !context" @click="automatic.retry">重试原启用请求</NButton></template></div>
      </NCard></NModal>
      <ScheduledPlanForm v-if="formOpen" ref="form" :plan="editing" :busy="writing" :uncertain="!!pending && !writing" :error="scheduleError(error)" :preview="rule => m.call('schedule_preview_time_v1', { rule })" :targets="(search, cursor) => m.call('schedule_list_targets_v1', { search, limit: 30, ...(cursor ? { cursor } : {}) })" @close="formOpen = false" @save="save" @query="checkReceipt" @retry="retryWrite" />
      <NModal :show="!!runReview" @after-enter="focusRunCancel" @after-leave="restoreRunFocus" :mask-closable="!runningAction && !runPending" :close-on-esc="!runningAction && !runPending" @update:show="manual.closeReview"><NCard class="scheduled-record-detail scheduled-run-confirmation" content-style="min-height: 0; display: flex; flex-direction: column; overflow: hidden" :title="rerunReview ? '确认重新执行一次' : '确认运行一次'" role="dialog" aria-modal="true" :aria-label="rerunReview ? '确认重新执行一次' : '确认运行一次'">
        <section class="scheduled-run-body" tabindex="0" aria-label="本次运行配置与差异"><template v-if="runReview"><NAlert v-if="rerunReview" type="info" :show-icon="false">使用当前已保存配置创建一次新运行，保留原记录及其结果。</NAlert><template v-if="rerunReview"><section v-for="change in rerunChanges" :key="change.label" class="scheduled-rerun-change"><h3>{{ change.label }}已变化</h3><p class="schedules-meta">原运行配置</p><p class="scheduled-record-body">{{ change.original }}</p><p class="schedules-meta">本次采用的当前配置</p><p class="scheduled-record-body">{{ change.current }}</p></section><p v-if="!rerunChanges.length">当前配置与原运行快照一致，仍会创建新运行。</p></template><h2>{{ runReview.plan.definition.name }}</h2><p class="schedules-meta">当前版本 {{ runReview.plan.revision }} · 运行于{{ targetLabels[runReview.plan.definition.target.mode] }}</p><p v-if="runReview.plan.definition.target.mode === 'existing_chat'">目标聊天：{{ manual.targetTitle.value || '已选择的聊天' }}<br>使用该聊天的原目录；权限模式固定为 Ask。</p><p v-else>使用应用为计划管理的独立目录；权限模式固定为 Ask。</p><p class="scheduled-record-body">{{ runReview.plan.definition.content }}</p><p>计划当前：{{ stateLabels[runReview.summary.effective_state] }}。{{ runReview.plan.definition.target.mode === 'new_chat_each_run' ? '本次将创建新聊天。' : '沿当前有效聊天关联执行，不恢复已删除的聊天。' }}</p><p v-if="runIntent?.grant">本次许可截止：{{ timeLabel(runIntent.grant.expires_at) }}</p><p>需要审批时，请进入完整对话处理；关闭详情不会停止已开始的任务。</p></template>
        <NAlert v-if="runError" type="error">{{ executionError(runError) }}</NAlert><p v-if="runPending" role="status">{{ runNotice || '正在提交，请稍候。' }}</p></section>
        <template #footer><p v-if="runReview">仅允许本次运行 1 次，许可最长 10 分钟，同时受当前会话授权限制。本次许可不改变计划状态、下一次时间或自动额度。</p><div class="schedules-actions"><NButton id="schedule-run-cancel" autofocus :disabled="runningAction || runPending" @click="manual.closeReview">取消</NButton><NButton v-if="!runPending" type="primary" :loading="runningAction" @click="manual.confirm">确认并运行一次</NButton><template v-else><NButton :disabled="runningAction || !context" @click="manual.query">查证本次原请求</NButton><NButton :disabled="runningAction || !context" @click="manual.retry">{{ runIntent?.grant && !runIntent.manualAttempted ? '继续本次运行' : '重试本次原请求' }}</NButton></template></div></template>
      </NCard></NModal>
      <NModal :show="!!recordDetail" @after-leave="afterRecordLeave" @update:show="recordDetail = null"><NCard class="scheduled-record-detail" :title="recordName" closable role="dialog" aria-modal="true" aria-label="执行记录详情" @close="recordDetail = null">
        <template v-if="recordDetail"><p>{{ recordStatus(recordDetail.record) }}</p><template v-if="recordDetail.configuration"><p>{{ ruleLabel(recordDetail.configuration.rule) }} · {{ targetLabels[recordDetail.configuration.target_mode] }}</p><p class="scheduled-record-body">{{ recordDetail.configuration.content }}</p></template><p v-else>此项未执行，没有运行时配置快照。</p><p>执行时间：{{ executionTimeLabel(recordDetail.record.timing) }}</p><p>执行耗时：{{ durationLabel(recordDetail.record.timing) }}</p><p class="schedules-meta">{{ timingNote(recordDetail.record.timing) }}</p><template v-if="recordDetail.record.kind === 'run'"><NButton :disabled="!canPrepare || recordDetail.record.plan.raw_state === 'deleted' || recordDetail.record.plan.target_state === 'missing' || runningAction || runPending || autoBusy || autoPending" @click="rerunFromDetail">审阅并重新执行</NButton><p v-if="recordDetail.record.attention === 'needs_attention'">审批或执行状态需要核对，请进入完整对话处理。读取记录不会重发原任务。</p><p v-else-if="recordDetail.record.run.native_outcome === 'failed'">本次执行失败，请在完整对话查看错误信息。系统没有自动重试。</p><p>触发方式：{{ { manual: '手动运行', automatic: '自动触发', rerun: '独立重跑' }[recordDetail.record.run.trigger] }} · 业务结果尚未评估</p><NButton :disabled="recordDetail.record.conversation.status !== 'available'" @click="openConversation(recordDetail)">查看完整对话</NButton><p v-if="recordDetail.record.conversation.status !== 'available'">对应对话已删除或关联尚不可用。</p></template></template>
      </NCard></NModal>
    </div>
  </YjPage>
</template>
<style scoped>
.schedules-page { display: grid; gap: var(--yj-space-5); min-width: 0; }
.schedules-toolbar { display: grid; grid-template-columns: minmax(180px, 1.5fr) minmax(110px, .7fr) minmax(180px, 1fr) auto; gap: var(--yj-space-3); align-items: center; }
.schedules-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-4); }
.schedules-records { display: grid; gap: var(--yj-space-4); }
.schedule-card { min-width: 0; }
.schedule-card__state { display: flex; gap: var(--yj-space-2); align-items: center; flex-shrink: 0; }
.schedule-card__title { color: inherit; font: inherit; text-align: left; border: 0; padding: 0; background: transparent; cursor: pointer; overflow-wrap: anywhere; }
.schedule-card__title:disabled { cursor: default; }
.schedule-card__title:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
.schedule-card__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); margin-top: var(--yj-space-3); opacity: 0; transition: opacity .12s; }
.schedule-plan-card:hover .schedule-card__actions, .schedule-plan-card:focus-within .schedule-card__actions { opacity: 1; }
@media (hover: none) { .schedule-card__actions { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .schedule-card__actions { transition: none; } }
.schedule-card__heading { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--yj-space-3); }
.schedule-card__heading h2 { margin: 0; font-size: var(--yj-font-size-section-title); overflow-wrap: anywhere; }
.schedule-card__content { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.schedules-meta { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.schedules-actions { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); margin-top: var(--yj-space-3); }
.schedules-more { display: flex; justify-content: center; padding: var(--yj-space-4); }
.scheduled-record-detail { width: min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-12))); max-height: calc(100vh - var(--yj-space-12)); overflow: auto; }
.scheduled-run-confirmation { overflow: hidden; }
.scheduled-run-body { flex: 1; min-height: 0; overflow: auto; }
.scheduled-run-body:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.scheduled-rerun-change { border-bottom: var(--yj-border-width) solid var(--yj-color-border-default); padding-bottom: var(--yj-space-3); }
.scheduled-record-body { white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 900px) { .schedules-toolbar { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .schedules-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
