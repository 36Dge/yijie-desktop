<script setup lang="ts">
import { computed } from "vue";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import type { ConversationApproval } from "../../domain/conversation-approval";
import type {
  ConversationCommandExecution,
  ConversationCommandOutput,
  ConversationSafeText,
  ConversationTruncationReason,
} from "../../domain/conversation-state";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import ChatApprovalCard, {
  type ChatApprovalErrorCode,
  type ChatApprovalCardStatus,
  type ChatApprovalDecisionRequest,
} from "./ChatApprovalCard.vue";
import ChatCopyAction from "./ChatCopyAction.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";

type StatusTone = "muted" | "primary" | "success" | "warning" | "error";

type OutputSection = Readonly<{
  key: "live" | "complete" | "head" | "tail";
  label: string;
  text: string;
}>;

export type ChatApprovalTransientState = Readonly<{
  phase: "idle" | "submitting" | "reconciling" | "error";
  errorCode: ChatApprovalErrorCode | null;
}>;

export type ChatApprovalDecisionChange = Readonly<{
  itemIdentity: string;
  threadId: string;
  turnId: string;
  itemId: string;
  approvalRequestId: string;
  decision: "accept_once" | "cancel_current_turn";
}>;

const props = withDefaults(defineProps<{
  item: ConversationTimelineItemViewModel;
  execution: ConversationCommandExecution;
  approval?: ConversationApproval | null;
  approvalTransient?: ChatApprovalTransientState | null;
  canDecideApproval?: boolean;
  approvalAuthorityRevision?: number;
}>(), {
  approval: null,
  approvalTransient: null,
  canDecideApproval: false,
  approvalAuthorityRevision: 0,
});

const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
  "approval-decision": [change: ChatApprovalDecisionChange];
}>();

const statusPresentation = computed<Readonly<{
  label: string;
  summary: string;
  icon: YjIconName;
  tone: StatusTone;
}>>(() => {
  switch (props.execution.status) {
    case "running":
      return { label: "执行中", summary: "命令正在执行。", icon: "pending", tone: "primary" };
    case "completed":
      return { label: "已完成", summary: "命令已完成。", icon: "check", tone: "success" };
    case "failed":
      return { label: "执行失败", summary: "命令执行失败。", icon: "warning", tone: "error" };
    case "declined":
      return { label: "已拒绝", summary: "命令未获执行。", icon: "stop", tone: "warning" };
    case "incomplete":
    default:
      return { label: "未完整结束", summary: "命令状态未完整结束。", icon: "warning", tone: "warning" };
  }
});

const defaultExpanded = computed(() =>
  props.execution.status === "running" || props.approval?.status === "pending");

const approvalCardStatus = computed<ChatApprovalCardStatus | null>(() => {
  const approval = props.approval;
  if (approval === null) return null;
  if (approval.status === "resolved") {
    switch (approval.outcome) {
      case "accepted_once":
        return "accepted";
      case "cancelled_current_turn":
        return "cancelled";
      case "expired":
        return "expired";
      case "resolved_elsewhere":
        return "resolved_elsewhere";
      case null:
      default:
        return "error";
    }
  }
  switch (props.approvalTransient?.phase) {
    case "submitting":
      return "submitting";
    case "reconciling":
      return "reconciling";
    case "error":
      return "error";
    case "idle":
    case undefined:
    default:
      break;
  }
  if (approval.authority !== "actionable") return "disconnected";
  return props.canDecideApproval ? "pending" : "error";
});

const approvalErrorCode = computed<ChatApprovalErrorCode | null>(() => {
  if (approvalCardStatus.value !== "error") return null;
  return props.approvalTransient?.errorCode ?? "approval_unavailable";
});

const approvalActionable = computed(() =>
  props.approval !== null && props.approval.status === "pending" &&
  props.approval.authority === "actionable" &&
  props.canDecideApproval && approvalCardStatus.value === "pending");

const cwdLabel = computed(() => {
  switch (props.execution.cwd.kind) {
    case "workspace_root":
      return "工作区根目录";
    case "workspace_relative":
      return props.execution.cwd.segments.length > 0
        ? props.execution.cwd.segments.join("/")
        : "工作区相对目录";
    case "redacted":
    default:
      return "路径已隐藏";
  }
});

const outputSections = computed<readonly OutputSection[]>(() => {
  const output = props.execution.output;
  if (output !== null) return completedOutputSections(output);
  const live = props.execution.liveOutput?.text ?? "";
  if (live === "") return Object.freeze([]);
  return Object.freeze([{
    key: "live" as const,
    label: props.execution.status === "running" ? "实时输出" : "已保留的实时输出",
    text: live,
  }]);
});

const copyText = computed(() => {
  const sections = outputSections.value;
  if (sections.length === 0) return "";
  if (sections.length === 1) return sections[0]?.text ?? "";
  return `${sections[0]?.text ?? ""}\n[中间内容已截断]\n${sections[1]?.text ?? ""}`;
});

const outputHeading = computed(() => {
  if (props.execution.output?.retention === "head_tail") return "保留输出";
  if (props.execution.output !== null) return "完成输出";
  return props.execution.status === "running" ? "实时输出" : "已保留输出";
});

const outputStateMessage = computed<string | null>(() => {
  const output = props.execution.output;
  if (output?.retention === "unavailable") {
    return "运行时未提供可用的聚合输出。";
  }
  if (output?.retention === "head_tail") {
    return `输出已截断；${truncationReasonLabel(output.truncationReason)}。`;
  }
  if (output?.retention === "complete" && (output.text ?? "") === "") {
    return "命令已完成，没有输出内容。";
  }
  if (output === null && props.execution.liveOutput === null) {
    return props.execution.status === "running"
      ? "正在等待安全输出…"
      : "本次命令没有可显示的完成输出。";
  }
  if (output === null && props.execution.status !== "running") {
    return "命令未形成完成快照，已保留收到的安全输出。";
  }
  return null;
});

const outputTruncation = computed(() => {
  if (props.execution.output?.retention === "head_tail") return null;
  if (props.execution.output?.truncated) {
    return `输出已截断；${truncationReasonLabel(props.execution.output.truncationReason)}。`;
  }
  if (props.execution.output === null && props.execution.liveOutput?.truncated) {
    return `实时输出已截断；${truncationReasonLabel(props.execution.liveOutput.truncationReason)}。`;
  }
  return null;
});

const durationLabel = computed(() => props.execution.durationMs === null
  ? null
  : formatDuration(props.execution.durationMs));

function completedOutputSections(output: ConversationCommandOutput): readonly OutputSection[] {
  switch (output.retention) {
    case "complete":
      return output.text === null
        ? Object.freeze([])
        : Object.freeze([{ key: "complete" as const, label: "完成输出", text: output.text }]);
    case "head_tail":
      return Object.freeze([
        { key: "head" as const, label: "输出开头", text: output.head ?? "" },
        { key: "tail" as const, label: "输出结尾", text: output.tail ?? "" },
      ]);
    case "unavailable":
    default:
      return Object.freeze([]);
  }
}

function truncationReasonLabel(reason: ConversationTruncationReason | null): string {
  return reason === "upstream_truncated" ? "上游仅提供了部分内容" : "已达到 UTF-8 字节限制";
}

function safeTextTruncation(summary: ConversationSafeText): string | null {
  return summary.truncated ? `摘要已截断；${truncationReasonLabel(summary.truncationReason)}。` : null;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} 毫秒`;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(durationMs / 1_000)} 秒`;
}

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
}

function forwardApprovalDecision(request: ChatApprovalDecisionRequest): void {
  const approval = props.approval;
  if (approval === null || request.approvalRequestId !== approval.approvalRequestId) return;
  emit("approval-decision", Object.freeze({
    itemIdentity: props.item.identity,
    threadId: props.item.threadId,
    turnId: props.item.turnId,
    itemId: props.item.itemId,
    approvalRequestId: request.approvalRequestId,
    decision: request.decision,
  }));
}
</script>

<template>
  <ChatTimelineItemShell
    :item="item"
    label="命令执行"
    :status-label="statusPresentation.label"
    icon="workspace"
    :status-icon="statusPresentation.icon"
    :status-tone="statusPresentation.tone"
    collapsible
    :default-expanded="defaultExpanded"
    @disclosure-change="forwardDisclosure"
  >
    <span
      class="chat-command-item__status-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ statusPresentation.summary }}</span>

    <div class="chat-command-item__details">
      <ChatApprovalCard
        v-if="approval && approvalCardStatus"
        :approval-request-id="approval.approvalRequestId"
        :status="approvalCardStatus"
        :expires-at="approval.expiresAt"
        :actionable="approvalActionable"
        :authority-revision="approvalAuthorityRevision"
        :error-code="approvalErrorCode"
        @decision="forwardApprovalDecision"
      />

      <dl class="chat-command-item__facts">
        <div>
          <dt>安全摘要</dt>
          <dd>{{ execution.commandSummary.text || "命令执行" }}</dd>
        </div>
        <div>
          <dt>工作目录</dt>
          <dd>{{ cwdLabel }}</dd>
        </div>
        <div v-if="durationLabel">
          <dt>耗时</dt>
          <dd>{{ durationLabel }}</dd>
        </div>
        <div v-if="execution.exitCode !== null">
          <dt>退出码</dt>
          <dd>{{ execution.exitCode }}</dd>
        </div>
      </dl>

      <p
        v-if="safeTextTruncation(execution.commandSummary)"
        class="chat-command-item__notice"
        role="note"
      >
        <YjIcon name="warning" size="sm" tone="warning" />
        <span>{{ safeTextTruncation(execution.commandSummary) }}</span>
      </p>

      <section class="chat-command-item__output" aria-label="命令输出">
        <header class="chat-command-item__section-header">
          <h3>{{ outputHeading }}</h3>
          <ChatCopyAction
            v-if="copyText"
            :adapter="browserChatClipboardAdapter"
            :text="copyText"
            kind="code"
          />
        </header>

        <p v-if="outputStateMessage" class="chat-command-item__state" role="note">
          {{ outputStateMessage }}
        </p>

        <div v-if="outputSections.length > 0" class="chat-command-item__output-sections">
          <section
            v-for="section in outputSections"
            :key="section.key"
            class="chat-command-item__output-section"
          >
            <h4 v-if="outputSections.length > 1">{{ section.label }}</h4>
            <pre>{{ section.text }}</pre>
          </section>
        </div>

        <p v-if="outputTruncation" class="chat-command-item__notice" role="note">
          <YjIcon name="warning" size="sm" tone="warning" />
          <span>{{ outputTruncation }}</span>
        </p>
      </section>

      <div v-if="execution.error" class="chat-command-item__error" role="note">
        <YjIcon name="warning" size="sm" tone="error" />
        <div>
          <strong>{{ execution.error.summary }}</strong>
          <code>{{ execution.error.code }}</code>
        </div>
      </div>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.chat-command-item__details,
.chat-command-item__output,
.chat-command-item__output-sections,
.chat-command-item__output-section,
.chat-command-item__error > div {
  display: grid;
  min-width: 0;
}

.chat-command-item__details,
.chat-command-item__output,
.chat-command-item__output-sections {
  gap: var(--yj-space-3);
}

.chat-command-item__facts {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: var(--yj-space-0);
  gap: var(--yj-space-2) var(--yj-space-4);
}

.chat-command-item__facts > div {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-1);
}

.chat-command-item__facts dt,
.chat-command-item__output h3,
.chat-command-item__output h4 {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-caption);
}

.chat-command-item__facts dd {
  min-width: 0;
  margin: var(--yj-space-0);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.chat-command-item__section-header,
.chat-command-item__notice,
.chat-command-item__error {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--yj-space-2);
}

.chat-command-item__section-header {
  align-items: center;
  justify-content: space-between;
}

.chat-command-item__state,
.chat-command-item__notice,
.chat-command-item__error,
.chat-command-item__error strong,
.chat-command-item__error code {
  margin: var(--yj-space-0);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  overflow-wrap: anywhere;
}

.chat-command-item__state,
.chat-command-item__notice {
  color: var(--yj-color-text-body);
}

.chat-command-item__output-section {
  gap: var(--yj-space-2);
}

.chat-command-item__output pre {
  max-width: 100%;
  max-height: calc(var(--yj-space-16) * 6);
  margin: var(--yj-space-0);
  padding: var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  font-family: var(--yj-font-family-mono);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-body);
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.chat-command-item__error {
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-semantic-error-ink);
  background: var(--yj-color-error-soft);
}

.chat-command-item__error > div {
  gap: var(--yj-space-1);
}

.chat-command-item__error code {
  color: var(--yj-color-text-secondary);
}

.chat-command-item__status-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: var(--yj-space-0);
  border: 0;
  margin: -1px;
  clip: rect(0 0 0 0);
  overflow: hidden;
  white-space: nowrap;
}

@media (max-width: 40rem) {
  .chat-command-item__facts {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
