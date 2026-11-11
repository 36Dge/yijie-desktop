<script setup lang="ts">
import { computed, inject, provide, ref, useId, watch } from "vue";
import type { ConversationTimelineItemViewModel, ConversationTimelineTurnViewModel, ConversationTimelineProgressViewModel, ConversationTimelineNoticeViewModel, ConversationTimelineArtifactReferenceContentBlock, ConversationTimelineAttachmentReferenceContentBlock } from "../../domain/conversation-timeline";
import type { SelectedChatSkill } from "../../domain/chat-skills";
import type { YjIconName } from "../../icons/registry";
import { conversationActivityPresentation, traceCurrentStatus, traceIsLive } from "../../domain/conversation-activity-presentation";
import { groupConversationTurnOutput, type ConversationTurnReadingNode } from "../../domain/conversation-turn-output";
import { chatTracePresentationKey, createChatTracePresentationStore } from "../../stores/chat-trace-presentation.store";
import YjIcon from "../yijie/YjIcon.vue";
import ChatActivityGroup from "./ChatActivityGroup.vue";
import ChatActivityRow from "./ChatActivityRow.vue";
import ChatTurnOutput from "./ChatTurnOutput.vue";
import ChatTurnPlan from "./ChatTurnPlan.vue";
import ChatTraceNotices from "./ChatTraceNotices.vue";
import ChatThinkingIndicator from "./ChatThinkingIndicator.vue";
import ChatDeepThinking from "./ChatDeepThinking.vue";
import { conversationReasoningSummary } from "../../domain/conversation-reasoning-summary";
import { useActivitySummary } from "./useActivitySummary";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import type { ChatApprovalDecisionChange, ChatApprovalTransientState } from "./ChatCommandItem.vue";
const props = withDefaults(defineProps<{
  turn: ConversationTimelineTurnViewModel;
  position: number;
  timingLabel?: string | null;
  skillCatalog?: readonly SelectedChatSkill[];
  connectorNames?: readonly string[];
  canDecideApprovals?: boolean;
  approvalAuthorityRevision?: number;
  approvalTransients?: Readonly<Record<string, ChatApprovalTransientState | undefined>>;
}>(), {
  timingLabel: null,
  skillCatalog: () => Object.freeze([]),
  connectorNames: () => Object.freeze([]),
  canDecideApprovals: false,
  approvalAuthorityRevision: 0,
  approvalTransients: () => Object.freeze({}),
});


const choices = inject(chatTracePresentationKey, null) ?? createChatTracePresentationStore();
provide(chatTracePresentationKey, choices);
const processId = `${useId()}-trace`;
const attentionIds = computed(() => new Set(props.turn.items.filter(item => item.approval && ["submitting", "reconciling", "error"].includes(props.approvalTransients[item.approval.approvalRequestId]?.phase ?? "idle")).map(item => item.identity)));
const nodes = computed(() => conversationActivityPresentation(props.turn, attentionIds.value, Boolean(slots["structured-answer"])));
const hasProcess = computed(() => Boolean(props.turn.plan) || nodes.value.some(node => node.kind === "activity" || node.kind === "message" && node.process));
const answerStarted = computed(() => props.turn.items.some(item => item.presentation === "final_answer" && item.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim())));
const nativeLiveProgress = computed(() => traceIsLive(props.turn));
const reasoningSummary = computed(() => conversationReasoningSummary(props.turn, nativeLiveProgress.value));
const reasoningHeader = useActivitySummary(computed(() => ({
  title: reasoningSummary.value?.title ?? "思考摘要",
  key: reasoningSummary.value?.key ?? "empty",
  state: reasoningSummary.value?.state ?? "summary",
})), () => reasoningSummary.value?.identity ?? `${props.turn.identity}:no-summary`);
const reasoningExpanded = computed(() => choices.get(`${props.turn.identity}:reasoning-summary`, false));
function toggleReasoning(change: ChatTimelineDisclosureChange) {
  choices.set(change.itemIdentity, change.expanded);
  emit("disclosure-change", change);
}
const hasOutput = computed(() => Boolean(props.turn.plan) || props.turn.items.some(item => item.presentation !== "user_message" && (item.approval || item.activityLabel || !["reasoning", "commentary", "final_answer", "assistant_unclassified"].includes(item.presentation) || item.contentBlocks.some(block => (block.type === "text" || block.type === "code") ? block.text.trim().length > 0 : true))));
const outputObserved = ref(false);
watch(() => [props.turn.identity, hasOutput.value] as const, ([identity, output], previous) => { outputObserved.value = previous?.[0] === identity ? outputObserved.value || output : output; }, {immediate: true, flush: "sync"});
// Keep the timing row's anchor through an optional metadata refresh. A missing
// label stays unknown; no earlier live estimate is promoted to final duration.
const timingObserved = ref(false);
watch(() => [props.turn.identity, props.timingLabel] as const, ([identity, label], previous) => {
  timingObserved.value = previous?.[0] === identity ? timingObserved.value || Boolean(label) : Boolean(label);
}, {immediate: true, flush: "sync"});
const preloading = computed(() => nativeLiveProgress.value && !outputObserved.value);
const processExpanded = computed(() => choices.get(props.turn.identity, nativeLiveProgress.value && !answerStarted.value));
const currentStatus = computed(() => traceCurrentStatus(props.turn));
const plan = computed(() => props.turn.plan ? {...props.turn.plan, defaultExpanded: false} : null);
const processControls = computed(() => nodes.value.filter(isProcess).map(node => `${processId}-${encodeURIComponent(node.identity)}`).concat(plan.value ? [`${processId}-plan`] : []).join(" "));
const entries = computed(() => {
  const list: (ConversationTurnReadingNode | {kind: "timing" | "plan" | "reasoning-summary"; identity: string})[] = [...groupConversationTurnOutput(props.turn, nodes.value)];
  const first = list.findIndex(node => node.kind !== "message" || node.item.presentation !== "user_message");
  const index = first < 0 ? list.length : first;
  list.splice(index, 0, {kind: "timing", identity: `${props.turn.identity}:timing`});
  if (plan.value) list.splice(index + 1, 0, {kind: "plan", identity: `${props.turn.identity}:plan`});
  if (reasoningSummary.value) {
    // A real public opening leads the process. This is a reading placement only:
    // unknown phases and the source Item order remain unchanged, and a final-only
    // history keeps its existing summary-before-answer layout.
    const firstPublic = list.findIndex(node => node.kind === "message" && node.item.kind === "assistant_message" &&
      node.item.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim()));
    const opening = list[firstPublic];
    const afterOpening = opening?.kind === "message" && (opening.item.presentation === "commentary" || opening.process);
    list.splice(afterOpening ? firstPublic + 1 : index + 1, 0, {kind: "reasoning-summary", identity: reasoningSummary.value.identity});
  }
  return list;
});
function isProcess(node: (typeof nodes.value)[number]) { return node.kind === "activity" || node.kind === "message" && node.process; }
function toggleProcess() {
  choices.set(props.turn.identity, !processExpanded.value);
  emit("disclosure-change", {itemIdentity: props.turn.identity, expanded: processExpanded.value});
}
function preserveProcess() { if (processExpanded.value) choices.set(props.turn.identity, true); }
function forwardDisclosure(change: ChatTimelineDisclosureChange) { preserveProcess(); emit("disclosure-change", change); }
const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
  "approval-decision": [change: ChatApprovalDecisionChange];
}>();
const slots = defineSlots<{
  "structured-answer"(props: { turnId: string }): unknown;
  "legacy-records"(props: {turnId: string}): unknown;
  "artifact-reference"(props: {
    item: ConversationTimelineItemViewModel;
    block: ConversationTimelineArtifactReferenceContentBlock;
  }): unknown;
  "attachment-reference"(props: {
    item: ConversationTimelineItemViewModel;
    block: ConversationTimelineAttachmentReferenceContentBlock;
  }): unknown;
  "item-actions"(props: { item: ConversationTimelineItemViewModel }): unknown;
  "code-actions"(props: {
    item: ConversationTimelineItemViewModel;
    codeIdentity: string;
    text: string;
    language: string | null;
  }): unknown;
}>();

function turnStatusLabel(turn: ConversationTimelineTurnViewModel): string {
  if (turn.diagnostic === "native_format_unsupported") return "历史记录暂不可读";
  if (["queued", "in_progress", "waiting_approval"].includes(turn.domainStatus) && turn.source === "legacy_archive") return "旧版记录，当前执行状态未确认";
  if (turn.source === "native_observed" && turn.domainStatus === "in_progress" && !turn.liveObserved) return "上次记录为进行中，当前进度待确认";
  if (turn.source === "local_submission") {
    if (turn.submissionStatus === "failed") return "提交失败";
    if (turn.submissionStatus === "uncertain") return "提交结果待确认";
    if (turn.submissionStatus === "cancelled") return "提交已取消";
    return "等待提交";
  }
  if (turn.statusSource === "runtime_read") {
    if (turn.domainStatus === "failed") return "历史记录显示失败，详情不完整";
    if (turn.domainStatus === "interrupted") return "历史记录显示已中断";
    if (turn.domainStatus === "completed") return "历史已结束，结果信息不完整";
  }
  switch (turn.domainStatus) {
    case "unknown":
      return "执行状态待确认";
    case "queued":
      return "等待处理";
    case "in_progress":
      return "正在处理";
    case "waiting_approval":
      return "等待继续";
    case "completed":
      return "已完成";
    case "interrupted":
      return "已中断";
    case "failed":
      return "未完成";
    case "recovery_required":
      return "需要核对";
  }
}

function turnStatusIcon(turn: ConversationTimelineTurnViewModel): YjIconName {
  if (turn.source === "local_submission" && turn.submissionStatus === "failed") return "warning";
  switch (turn.phase) {
    case "complete":
      return "check";
    case "interrupted":
      return "stop";
    case "failed":
    case "recovery_required":
      return "warning";
    default:
      return "pending";
  }
}

function progressLabel(progress: ConversationTimelineProgressViewModel): string {
  if (props.turn.source === "local_submission" && props.turn.submissionStatus === "uncertain") {
    return "原提交结果尚未确认，请先核对原操作，勿重复发送。";
  }
  switch (progress.domainStatus) {
    case "queued":
      return "本轮正在等待处理";
    case "in_progress":
      return "本轮正在处理中";
    case "waiting_approval":
      return "本轮正在等待继续";
  }
}

function turnStateMessage(turn: ConversationTimelineTurnViewModel): string | null {
  if (turn.diagnostic === "native_format_unsupported") return "这条历史由较新版本保存，请使用兼容版本查看。原记录已保留，不会重新提交。";
  if (turn.source === "local_submission") {
    if (turn.submissionStatus === "failed") return "本次提交未成功，原消息已保留。";
    if (turn.submissionStatus === "cancelled") return "本次提交已取消，原消息已保留。";
  }
  switch (turn.domainStatus) {
    case "interrupted":
      return "本轮已中断，已确认的内容仍可阅读。";
    case "failed":
      return "本轮未能完成，已确认的内容仍可阅读。";
    case "recovery_required":
      return "本轮状态需要核对，现有内容仍可阅读。";
    default:
      return null;
  }
}

function noticeMessage(notice: ConversationTimelineNoticeViewModel): string {
  const message = notice.severity === "error"
    ? "本轮发生错误，已保留可用内容。"
    : "本轮存在需要注意的信息。";
  return notice.count > 1 ? `${message} 共 ${notice.count} 次。` : message;
}


</script>
<template>
  <section
    class="chat-turn-group"
    :class="`chat-turn-group--${turn.phase}`"
    :aria-label="`对话 ${position}`"
  >
    <header v-if="turn.diagnostic === 'native_format_unsupported' || (turn.domainStatus !== 'completed' && !nativeLiveProgress)" class="chat-turn-group__header">
      <span class="chat-turn-group__status">
        <YjIcon
          :name="turnStatusIcon(turn)"
          size="sm"
          :tone="turn.phase === 'failed' || turn.phase === 'recovery_required' ? 'warning' : 'muted'"
        />
        {{ turnStatusLabel(turn) }}
        <span v-if="turn.source === 'legacy_archive'"> · 旧版记录</span>
        <span v-else-if="turn.source === 'native_rebuilt'"> · 历史恢复，内容可能不完整</span>
      </span>
    </header>

    <p v-if="turnStateMessage(turn)" class="chat-turn-group__turn-state" role="note">
      {{ turnStateMessage(turn) }}
    </p>


    <ol v-if="nodes.length || timingObserved || plan || preloading" class="chat-turn-group__items" aria-label="本轮对话内容">
      <template v-for="node in entries" :key="node.identity">
        <li v-if="node.kind === 'timing' && (hasProcess || timingObserved || preloading)" class="chat-turn-group__timing">
          <span v-if="preloading" class="chat-turn-group__thinking" role="status" aria-live="polite"><ChatThinkingIndicator /></span>
          <button v-else-if="hasProcess" class="chat-turn-group__process-toggle" type="button" :aria-expanded="processExpanded" :aria-controls="processControls" @click="toggleProcess">
            {{ timingLabel || '处理过程' }}<YjIcon :name="processExpanded ? 'chevronDown' : 'chevronRight'" size="xs" tone="muted" />
          </button>
          <span v-else>{{ timingLabel || '耗时待确认' }}</span>
        </li>
        <li v-else-if="node.kind === 'reasoning-summary' && reasoningSummary" class="chat-turn-group__reasoning-summary">
          <ChatDeepThinking :item="reasoningSummary.items[0]!" :items="reasoningSummary.items" :disclosure-identity="reasoningSummary.identity"
            label="思考摘要" :title="reasoningHeader.title" :expanded="reasoningExpanded" :visible="true" :live="nativeLiveProgress"
            :thinking="reasoningSummary.state === 'thinking'" :state-message="reasoningSummary.stateMessage" @disclosure-change="toggleReasoning" />
        </li>
        <li v-else-if="node.kind === 'plan' && plan" v-show="processExpanded" :id="`${processId}-plan`" @focusin="preserveProcess" @pointerdown="preserveProcess">
          <ChatTurnPlan :plan="plan" :ended="['completed', 'failed', 'interrupted'].includes(turn.domainStatus)" />
        </li>
        <li v-else-if="node.kind === 'output'" class="chat-turn-group__item chat-turn-group__item--output">
          <ChatTurnOutput :output="node" :turn="turn">
            <template v-if="slots['structured-answer']" #structured-answer="scope"><slot name="structured-answer" v-bind="scope" /></template>
            <template v-if="slots['artifact-reference']" #artifact-reference="scope"><slot name="artifact-reference" v-bind="scope" /></template>
            <template v-if="slots['attachment-reference']" #attachment-reference="scope"><slot name="attachment-reference" v-bind="scope" /></template>
            <template v-if="slots['item-actions']" #item-actions="scope"><slot name="item-actions" v-bind="scope" /></template>
            <template v-if="slots['code-actions']" #code-actions="scope"><slot name="code-actions" v-bind="scope" /></template>
          </ChatTurnOutput>
        </li>
        <li v-else-if="node.kind === 'activity' || node.kind === 'message' || node.kind === 'attention'" v-show="node.kind === 'attention' || node.kind === 'message' && node.item.presentation === 'user_message' || !preloading && (!isProcess(node) || processExpanded)" :id="`${processId}-${encodeURIComponent(node.identity)}`" :class="`chat-turn-group__item--${node.kind === 'activity' ? 'activity' : node.item.presentation}`" class="chat-turn-group__item" :data-process-item="isProcess(node) ? '' : undefined" @focusin="isProcess(node) && preserveProcess()" @pointerdown="isProcess(node) && preserveProcess()">
          <ChatActivityGroup v-if="node.kind === 'activity'" :group="node.group" :live="nativeLiveProgress" :visible="processExpanded" @disclosure-change="forwardDisclosure">
            <template #item="{ item, entry, visible }">
              <ChatActivityRow :item="item" :activity-entry="entry" :turn="turn" process-presentation :visible="visible" :can-decide-approvals="canDecideApprovals" :approval-authority-revision="approvalAuthorityRevision" :approval-transients="approvalTransients" @disclosure-change="forwardDisclosure" @approval-decision="emit('approval-decision', $event)" />
            </template>
          </ChatActivityGroup>
          <ChatActivityRow v-else :item="node.item" :turn="turn" :answer-candidate="node.answerCandidate" :process-presentation="node.process" :visible="!isProcess(node) || processExpanded" :skill-catalog="skillCatalog" :connector-names="connectorNames" :can-decide-approvals="canDecideApprovals" :approval-authority-revision="approvalAuthorityRevision" :approval-transients="approvalTransients" @disclosure-change="forwardDisclosure" @approval-decision="emit('approval-decision', $event)">
            <template v-if="slots['structured-answer']" #structured-answer="slotProps"><slot name="structured-answer" v-bind="slotProps" /></template>
<template v-if="slots['legacy-records']" #legacy-records="slotProps"><slot name="legacy-records" v-bind="slotProps" /></template>
<template v-if="slots['artifact-reference']" #artifact-reference="slotProps"><slot name="artifact-reference" v-bind="slotProps" /></template>
<template v-if="slots['attachment-reference']" #attachment-reference="slotProps"><slot name="attachment-reference" v-bind="slotProps" /></template>
<template v-if="slots['item-actions']" #item-actions="slotProps"><slot name="item-actions" v-bind="slotProps" /></template>
<template v-if="slots['code-actions']" #code-actions="slotProps"><slot name="code-actions" v-bind="slotProps" /></template>
          </ChatActivityRow>
        </li>
      </template>
    </ol>
    <p v-if="currentStatus && !preloading" class="chat-turn-group__progress" role="status" aria-live="polite"><ChatThinkingIndicator :label="currentStatus" :active="nativeLiveProgress" /></p>
    <p v-else-if="turn.progress && turn.source === 'local_submission' && !['failed', 'cancelled'].includes(turn.submissionStatus ?? '')" class="chat-turn-group__progress" role="status">{{ progressLabel(turn.progress) }}</p>
    <ChatTraceNotices v-if="turn.traceNotices" :notices="turn.traceNotices" />
    <ul v-if="turn.notices.length" class="chat-turn-group__notices" aria-label="本轮通知">
      <li v-for="notice in turn.notices" :key="notice.identity" class="chat-turn-group__notice"><div role="note">{{ noticeMessage(notice) }}<code>{{ notice.code }}</code></div></li>
    </ul>
  </section>
</template>
<style scoped>
.chat-turn-group__skill-mention { margin-inline-end: var(--yj-space-2); }
.chat-turn-group__connector-mention { color: var(--yj-color-connector-mention); margin-inline-end: var(--yj-space-2); overflow-wrap: anywhere; }
.chat-turn-group__process-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-1);
  padding: var(--yj-space-1) 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.chat-turn-group__process-toggle:hover { color: var(--yj-color-text-primary); }
.chat-turn-group__process-toggle:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-turn-group__timing {
  min-height: calc(var(--yj-line-height-body) + var(--yj-space-2));
  /* Tighten only the space after the timing row, keeping the button's hit area. */
  margin-block-end: calc(-1 * var(--yj-space-1));
  color: var(--yj-color-chat-timing);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  font-variant-numeric: tabular-nums;
}
.chat-turn-group__timing .chat-turn-group__process-chevron { color: inherit; }
.chat-turn-group__thinking { display: inline-block; padding-block: var(--yj-space-1); }
.chat-turn-status-enter-active,
.chat-turn-status-leave-active { transition: opacity var(--yj-motion-fast) var(--yj-ease-standard); }
.chat-turn-status-enter-from,
.chat-turn-status-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce), (forced-colors: active) {
  .chat-turn-status-enter-active,
  .chat-turn-status-leave-active { transition: none; }
}

.chat-turn-group__progress-source { margin: 0 0 var(--yj-space-1); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }

.chat-turn-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  gap: var(--yj-space-3);
  padding-block: var(--yj-space-4);
}

.chat-turn-group + .chat-turn-group {
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.chat-turn-group__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--yj-space-3);
}

.chat-turn-group__status,
.chat-turn-group__progress {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__progress {
  width: fit-content;
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.chat-turn-group__turn-state {
  margin: var(--yj-space-0);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-body);
  background: var(--yj-color-warning-soft);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__items,
.chat-turn-group__notices {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-4);
  list-style: none;
}

.chat-turn-group__item {
  min-width: 0;
}

.chat-turn-group__item--user_message {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  justify-items: end;
}

.chat-turn-group__item--user_message :deep(.chat-timeline-item-shell) {
  max-width: var(--yj-layout-chat-user-bubble-max);
}

.chat-turn-group__unknown {
  display: grid;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.chat-turn-group__draft-note {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__unknown code,
.chat-turn-group__notice code {
  width: fit-content;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__notices {
  gap: var(--yj-space-2);
}

.chat-turn-group__notice-body {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-body);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-turn-group__notice--error .chat-turn-group__notice-body {
  border-color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-turn-group__notice--warning .chat-turn-group__notice-body {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}
</style>

<style scoped>
/* Compact adjacent search entries without changing other process spacing. */
.chat-turn-group__item--web_search + .chat-turn-group__item--web_search {
  margin-block-start: calc(-1 * var(--yj-space-3));
}
</style>
