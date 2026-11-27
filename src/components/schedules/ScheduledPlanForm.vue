<script setup lang="ts">
import { executionProfile, defaultModelProfile, kimiK31Candidate } from "../../api/chat-model-client";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, useId, watch } from "vue";
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NConfigProvider, NForm, NFormItem, NInput, NModal, NSelect, useDialog, type InputInst } from "naive-ui";
import { scheduleFieldTheme } from "../../design/theme/schedule-field-theme";
import type { PlanDefinition, PlanView, TimePreview, TimeRule } from "../../domain/scheduled-plan-v2.generated";
import type { TargetPage } from "../../api/generated/scheduled-task-ipc-v2.gen";
import { defaultScheduledTimeRule, frequencyLabels, targetLabels, timeLabel } from "../../domain/scheduled-task-ui";
import { chatModelsEnabled, type ProfileId } from "../../api/chat-model-client";
import { useScheduledPlanModel } from "../../composables/useScheduledPlanModel";
import YjIcon from "../yijie/YjIcon.vue";
import ScheduledTimePicker from "./ScheduledTimePicker.vue";
import ScheduledDatePicker from "./ScheduledDatePicker.vue";
const props = defineProps<{ plan: PlanView | null; boundConversationId?: string | null; initialDefinition?: PlanDefinition; confirmation?: boolean; busy: boolean; uncertain: boolean; error: string; preview: (rule: TimeRule) => TimePreview | Promise<TimePreview>; targets: (search: string, cursor?: string) => Promise<TargetPage> }>();
const emit = defineEmits<{ close: []; query: []; retry: []; save: [definition: PlanDefinition] }>();
const dialog = useDialog();
const initial = props.plan?.definition ?? props.initialDefinition;
const initialRule = initial?.rule ?? defaultScheduledTimeRule();
const settingsInitiallyOpen = (!props.plan && !props.confirmation) || initial?.target.mode === "existing_chat";
const title = computed(() => props.confirmation ? "确认定时任务草案" : props.plan ? "编辑定时任务" : "新建定时任务");
const form = reactive({ modelProfile: (initial?.model_profile ?? (props.plan ? "minimax-m3-high-v1" : defaultModelProfile)) as ProfileId, name: initial?.name ?? "", content: initial?.content ?? "", frequency: initialRule.frequency, timeZone: initialRule.time_zone, localTime: initialRule.local_time, localDate: initialRule.local_date ?? "", weekdays: initialRule.weekdays?.slice() ?? [1], mode: initial?.target.mode ?? "dedicated_chat", conversationId: initial?.target.conversation_id ?? null });
const {modelOptions,modelReady,modelNotice,modelLocked}=useScheduledPlanModel(form, () => props.boundConversationId ?? null);
const visibleModelOptions = computed(() => modelOptions.filter(
  option => option.value !== "kimi-k3-1-pro-max-v1" || option.value === form.modelProfile,
));
const formId = useId();
const nameInput = ref<InputInst | null>(null);
const selectMenuProps = { class: "schedule-form-select-menu" };
const formTheme = {
  ...scheduleFieldTheme,
  InternalSelection: { ...scheduleFieldTheme.InternalSelection, heightMedium: "var(--yj-control-height-md)" },
  Form: { labelFontWeight: "var(--yj-font-weight-medium)" },
};
const targetHelp = computed(() => ({ dedicated_chat: "在专属聊天中持续保存此任务的结果。", new_chat_each_run: "每次执行创建新聊天，分别保存结果。", existing_chat: "使用所选聊天及其目录执行。" })[form.mode]);
const requiresModelReview = computed(() => kimiK31Candidate && (
  props.confirmation || form.modelProfile !== "minimax-m3-high-v1" || (props.plan && initial?.model_profile !== form.modelProfile)
));
const saveNotice = computed(() => {
  if (requiresModelReview.value || (props.confirmation && chatModelsEnabled)) {
    const outcome = props.plan ? "保存后任务将关闭，原授权失效。" : "任务将以关闭状态保存，执行需另行授权。";
    return outcome + "核对模型与任务内容后，可开启任务或选择单次执行。";
  }
  return props.plan ? "保存后保留当前开关状态，可在任务列表中调整。" : "创建后将自动开启，按设定时间执行，可随时关闭。";
});
const initialJson = JSON.stringify(form);
const dirty = computed(() => JSON.stringify(form) !== initialJson);
const blocked = computed(() => props.busy || props.uncertain);
const rule = computed<TimeRule>(() => ({ frequency: form.frequency, time_zone: form.timeZone.trim(), local_time: form.localTime.trim(), ...(form.frequency === "once" ? { local_date: form.localDate.trim() } : {}), ...(form.frequency === "weekly" ? { weekdays: form.weekdays.slice().sort() } : {}) }));
type SchedulePreview =
  | { state: "loading" | "incomplete" | "error"; message: string }
  | { state: "ready"; time: string };
const timePreview = ref<SchedulePreview>({ state: "loading", message: "正在计算执行时间…" });
const targetOptions = ref<{ label: string; value: string }[]>([]); const targetCursor = ref<string>(); const targetSearch = ref(""); const targetError = ref(""); const targetLoading = ref(false);
let previewEpoch = 0; let targetEpoch = 0; let alive = true; let previewTimer: ReturnType<typeof setTimeout> | undefined; let targetTimer: ReturnType<typeof setTimeout> | undefined;
const frequencyOptions = Object.entries(frequencyLabels).map(([value,label]) => ({value,label}));
const modeOptions = Object.entries(targetLabels).map(([value,label]) => ({value,label}));
const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];
const valid = computed(() => {
  const modelAvailable = !chatModelsEnabled || (
    !!executionProfile(form.modelProfile) && modelReady.value && modelOptions.some(option => option.value === form.modelProfile && !option.disabled)
  );
  const nameLength = Array.from(form.name.trim()).length;
  const contentLength = Array.from(form.content.trim()).length;
  return modelAvailable && nameLength > 0 && nameLength <= 80 && contentLength > 0 && contentLength <= 10000
    && timePreview.value.state === "ready" && (form.mode !== "existing_chat" || !!form.conversationId);
});
watch(rule, (currentRule, previousRule) => {
  const epoch = ++previewEpoch;
  clearTimeout(previewTimer);
  if (currentRule.frequency === "once" && !currentRule.local_date) {
    timePreview.value = { state: "incomplete", message: "选择运行日期后可预览执行时间。" };
    return;
  }
  timePreview.value = { state: "loading", message: "正在计算执行时间…" };
  async function updatePreview() {
    try {
      const preview = props.preview(currentRule);
      const result = "then" in preview ? await preview : preview;
      if (!alive || epoch !== previewEpoch) return;
      timePreview.value = result.next_at === undefined
        ? { state: "error", message: "没有未来运行时间，请调整日期或规则。" }
        : { state: "ready", time: timeLabel(result.next_at, currentRule.time_zone) };
    } catch {
      if (alive && epoch === previewEpoch) {
        timePreview.value = { state: "error", message: "无法计算执行时间，请检查日期、时间、运行日和时区。" };
      }
    }
  }
  if (previousRule === undefined) void updatePreview();
  else previewTimer = setTimeout(updatePreview, 250);
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
  const modelProfile = executionProfile(form.modelProfile);
  if (chatModelsEnabled && !modelProfile) return;
  emit("save", { ...(chatModelsEnabled ? {model_profile:modelProfile} : {}), name: form.name.trim(), content: form.content.trim(), rule: rule.value, target: { mode: form.mode, ...(form.mode === "existing_chat" && form.conversationId ? { conversation_id: form.conversationId } : {}) } });
}
onMounted(async () => {
  await nextTick();
  if (!blocked.value) nameInput.value?.focus();
});
onBeforeUnmount(() => { alive = false; previewEpoch++; targetEpoch++; clearTimeout(previewTimer); clearTimeout(targetTimer); });
defineExpose({ dirty, close });
</script>
<template>
  <NModal :show="true" :mask-closable="false" :close-on-esc="!blocked" @update:show="close">
    <NCard
      class="schedule-form" header-class="schedule-form__header" content-class="schedule-form__scroll" footer-class="schedule-form__footer"
      role="dialog" aria-modal="true" :aria-label="title" :aria-describedby="`${formId}-intro`"
    >
      <template #header>
        <div class="schedule-form__heading">
          <span class="schedule-form__symbol"><YjIcon name="scheduledTask" size="xl" :stroke-width="1.5" /></span>
          <div>
            <h2>{{ title }}</h2>
            <p :id="`${formId}-intro`" class="schedule-form__intro">{{ saveNotice }}</p>
          </div>
        </div>
      </template>
      <template #header-extra>
        <NButton quaternary circle size="small" aria-label="关闭弹窗" :disabled="blocked" @click="close">
          <template #icon><YjIcon name="dismiss" size="md" tone="muted" /></template>
        </NButton>
      </template>

      <NConfigProvider abstract :theme-overrides="formTheme">
        <NForm :id="formId" class="schedule-form__body" label-placement="top" :show-feedback="false" :disabled="blocked" :aria-busy="busy" @submit.prevent="submit">
          <NAlert v-if="error" type="error" role="alert">{{ error }}</NAlert>
          <NAlert v-if="uncertain" type="warning" role="status">
            保存结果待查证。
            <div class="schedule-form__recovery">
              <NButton :disabled="busy" @click="emit('query')">查证原请求</NButton>
              <NButton :disabled="busy" @click="emit('retry')">重试同一请求</NButton>
            </div>
          </NAlert>

          <div class="schedule-form__columns">
            <div class="schedule-form__fields">
              <NFormItem label="任务名称" required :label-props="{ for: `${formId}-name` }">
                <NInput ref="nameInput" v-model:value="form.name" placeholder="例如，每日商品巡检" :maxlength="80" show-count
                  :input-props="{ id: `${formId}-name`, 'aria-label': '任务名称', 'aria-required': 'true' }" />
              </NFormItem>
              <NFormItem label="任务内容" required :label-props="{ for: `${formId}-content` }">
                <NInput v-model:value="form.content" type="textarea" placeholder="例如，汇总商品信息，列出价格变化和待优化项。"
                  :autosize="{ minRows: 5, maxRows: 8 }" :maxlength="10000" show-count
                  :input-props="{ id: `${formId}-content`, 'aria-label': '任务内容', 'aria-required': 'true' }" />
              </NFormItem>
            </div>

            <div class="schedule-form__fields schedule-form__execution">
              <div class="schedule-form__time">
                <NFormItem label="计划时间" required>
                  <div class="schedule-form__pair">
                    <NSelect v-model:value="form.frequency" :options="frequencyOptions" :menu-props="selectMenuProps" aria-label="频率" />
                    <ScheduledTimePicker v-model="form.localTime" :disabled="blocked" :described-by="`${formId}-time-hint`" />
                  </div>
                </NFormItem>
                <NFormItem v-if="form.frequency === 'once'" label="运行日期" required>
                  <ScheduledDatePicker v-model="form.localDate" :time-zone="form.timeZone" :disabled="blocked" :described-by="`${formId}-time-hint`" />
                </NFormItem>
                <NFormItem v-if="form.frequency === 'weekly'" label="每周运行日" required>
                  <NCheckboxGroup v-model:value="form.weekdays" class="schedule-form__weekdays" aria-label="每周运行日">
                    <NCheckbox v-for="(label, index) in weekLabels" :key="label" :value="index + 1" :label="`周${label}`" />
                  </NCheckboxGroup>
                </NFormItem>
                <div :id="`${formId}-time-hint`" class="schedule-form__preview" :data-state="timePreview.state" role="status" aria-atomic="true" :aria-busy="timePreview.state === 'loading'">
                  <YjIcon :name="timePreview.state === 'error' ? 'warning' : 'pending'" size="sm" :tone="timePreview.state === 'error' ? 'warning' : 'muted'" />
                  <div class="schedule-form__next">
                    <div class="schedule-form__next-meta"><span>启用后预计执行</span><span>{{ rule.time_zone }}</span></div>
                    <strong v-if="timePreview.state === 'ready'">{{ timePreview.time }}</strong>
                    <span v-else class="schedule-form__next-message">{{ timePreview.message }}</span>
                  </div>
                </div>
              </div>
              <div v-if="chatModelsEnabled" class="schedule-form__model">
                <NFormItem label="执行模型" required>
                  <NSelect v-model:value="form.modelProfile" :options="visibleModelOptions" :menu-props="selectMenuProps"
                    :disabled="blocked || !modelReady || modelLocked" aria-label="执行模型" :aria-describedby="`${formId}-model-hint`" />
                </NFormItem>
                <p :id="`${formId}-model-hint`" class="schedule-form__hint" role="status">{{ modelNotice }}</p>
              </div>
            </div>
          </div>

          <details class="schedule-form__settings" :open="settingsInitiallyOpen">
            <summary>
              <YjIcon name="settings" size="sm" tone="muted" />
              <span class="schedule-form__settings-title">更多设置</span>
              <span class="schedule-form__settings-summary">{{ form.timeZone }} · {{ targetLabels[form.mode] }}</span>
              <YjIcon class="schedule-form__chevron" name="chevronDown" size="sm" tone="muted" />
            </summary>
            <div class="schedule-form__settings-body">
              <div class="schedule-form__pair schedule-form__targets">
                <NFormItem label="时区" required :label-props="{ for: `${formId}-zone` }">
                  <NInput v-model:value="form.timeZone" placeholder="Asia/Shanghai" :input-props="{ id: `${formId}-zone`, 'aria-label': '时区', 'aria-required': 'true' }" />
                </NFormItem>
                <NFormItem label="运行于" required>
                  <NSelect v-model:value="form.mode" :options="modeOptions" :menu-props="selectMenuProps" aria-label="运行于" :aria-describedby="`${formId}-target-hint`" />
                </NFormItem>
              </div>
              <template v-if="form.mode === 'existing_chat'">
                <NFormItem label="已有聊天" required>
                  <NSelect v-model:value="form.conversationId" filterable remote :options="targetOptions" :loading="targetLoading" :menu-props="selectMenuProps"
                    :fallback-option="value => ({ value, label: '当前关联聊天（请核对）' })" placeholder="搜索并选择聊天" aria-label="已有聊天" @search="searchTargets" />
                </NFormItem>
                <p v-if="plan?.target_state === 'missing'" class="schedule-form__error" role="alert">原关联聊天已失效，请选择其他聊天。</p>
                <p v-if="targetError" class="schedule-form__error" role="alert">{{ targetError }} <NButton size="small" @click="loadTargets()">重试</NButton></p>
                <NButton v-if="targetCursor" class="schedule-form__more-targets" size="small" :loading="targetLoading" @click="loadTargets(true)">更多聊天</NButton>
              </template>
              <p :id="`${formId}-target-hint`" class="schedule-form__hint">{{ targetHelp }}</p>
            </div>
          </details>
        </NForm>
      </NConfigProvider>
      <template #footer>
        <div class="schedule-form__actions">
          <NButton :disabled="blocked" @click="close">取消</NButton>
          <NButton type="primary" :bordered="false" attr-type="submit" :form="formId" :disabled="!valid || blocked" :loading="busy">保存</NButton>
        </div>
      </template>
    </NCard>
  </NModal>
</template>

<style scoped>
.schedule-form {
  --yj-elevated-field-border: var(--yj-color-border-subtle);
  --form-inset: var(--yj-space-6);
  width: min(var(--yj-layout-schedule-form-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)));
  max-height: calc(var(--yj-ui-viewport-height, 100vh) - var(--yj-space-8));
  overflow: hidden;
  container: schedule-editor / inline-size;
  border-radius: var(--yj-radius-xl);
  box-shadow: var(--yj-shadow-modal);
}

.schedule-form :deep(.schedule-form__header) {
  flex: none;
  align-items: flex-start;
  gap: var(--yj-space-3);
  padding: var(--yj-space-5) var(--form-inset);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.schedule-form__heading { display: flex; align-items: flex-start; gap: var(--yj-space-3); }
.schedule-form__symbol {
  --yj-color-icon-default: var(--yj-color-on-brand);
  display: grid;
  flex: none;
  place-items: center;
  width: var(--yj-control-height-lg);
  height: var(--yj-control-height-lg);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-brand-primary);
}
.schedule-form__heading h2 {
  margin: 0;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
  line-height: var(--yj-line-height-section-title);
  font-weight: var(--yj-font-weight-semibold);
}
.schedule-form__intro, .schedule-form__hint, .schedule-form__error {
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-weight: var(--yj-font-weight-regular);
  overflow-wrap: anywhere;
}
.schedule-form__intro { margin-top: var(--yj-space-1); font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
.schedule-form__error { color: var(--yj-color-semantic-error-ink); }

.schedule-form :deep(.schedule-form__scroll) {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: var(--yj-space-5) var(--form-inset);
}
.schedule-form__body { display: grid; gap: var(--yj-space-5); }
.schedule-form__columns {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
  gap: var(--yj-space-6);
}
.schedule-form__fields { display: grid; min-width: 0; align-content: start; gap: var(--yj-space-4); }
.schedule-form__execution { padding-inline-start: var(--yj-space-6); border-inline-start: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.schedule-form__pair { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-3); }
/* The select positions its portal using the trigger's visual-pixel bounds. */
:global(.v-binder-follower-container:has(> .v-binder-follower-content > .schedule-form-select-menu)) { zoom: calc(1 / var(--yj-ui-scale, 1)); }
:global(.schedule-form-select-menu) { zoom: var(--yj-ui-scale, 1); }
.schedule-form__time { display: grid; gap: var(--yj-space-2); }
.schedule-form__model { display: grid; gap: var(--yj-space-1); min-width: 0; }
.schedule-form__weekdays { display: flex; flex-wrap: wrap; gap: var(--yj-space-2) var(--yj-space-3); }
.schedule-form__weekdays :deep(.n-checkbox) { margin: 0; }
.schedule-form__preview {
  display: flex;
  align-items: flex-start;
  gap: var(--yj-space-2);
  min-height: calc(var(--yj-line-height-caption) + var(--yj-line-height-body) + var(--yj-space-4));
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-control-hover);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  overflow-wrap: anywhere;
}
.schedule-form__preview[data-state="error"] { color: var(--yj-color-semantic-warning-ink); background: var(--yj-color-warning-soft); }
.schedule-form__next { min-width: 0; flex: 1; }
.schedule-form__next-message { display: block; line-height: var(--yj-line-height-body); }
.schedule-form__next-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 var(--yj-space-2); }
.schedule-form__next strong {
  display: block;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  font-weight: var(--yj-font-weight-semibold);
  font-variant-numeric: tabular-nums;
}

.schedule-form__settings { min-width: 0; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-lg); }
.schedule-form__settings summary {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  min-height: var(--yj-control-height-lg);
  padding: var(--yj-space-2) var(--yj-space-3);
  color: var(--yj-color-text-primary);
  border-radius: inherit;
  list-style: none;
  cursor: pointer;
}
.schedule-form__settings summary::-webkit-details-marker { display: none; }
.schedule-form__settings summary:hover { background: var(--yj-color-control-hover); }
.schedule-form__settings summary:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.schedule-form__settings-title { flex: none; font-size: var(--yj-font-size-body); font-weight: var(--yj-font-weight-medium); }
.schedule-form__settings-summary { min-width: 0; margin-inline-start: auto; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); text-align: end; overflow-wrap: anywhere; }
.schedule-form__settings[open] summary { border-end-start-radius: 0; border-end-end-radius: 0; }
.schedule-form__settings[open] .schedule-form__settings-summary { display: none; }
.schedule-form__settings[open] .schedule-form__chevron { margin-inline-start: auto; transform: rotate(180deg); }
.schedule-form__settings-body { display: grid; gap: var(--yj-space-2); padding: var(--yj-space-3); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.schedule-form__more-targets { justify-self: start; }

.schedule-form :deep(.schedule-form__footer) {
  flex: none;
  padding: var(--yj-space-3) var(--form-inset);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}
.schedule-form__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-2); }
.schedule-form__actions :deep(.n-button) { min-width: calc(var(--yj-control-height-lg) * 2); }
.schedule-form__recovery { display: flex; flex-wrap: wrap; gap: var(--yj-space-2); margin-top: var(--yj-space-2); }

@container schedule-editor (max-width: 640px) {
  .schedule-form__columns { grid-template-columns: minmax(0, 1fr); gap: var(--yj-space-4); }
  .schedule-form__execution { padding-inline-start: 0; border-inline-start: 0; padding-top: var(--yj-space-4); border-top: var(--yj-border-width) solid var(--yj-color-border-subtle); }
}
@container schedule-editor (max-width: 440px) {
  .schedule-form :deep(.schedule-form__header), .schedule-form :deep(.schedule-form__scroll), .schedule-form :deep(.schedule-form__footer) { padding-inline: var(--yj-space-4); }
  .schedule-form__targets { grid-template-columns: minmax(0, 1fr); }
}
</style>
