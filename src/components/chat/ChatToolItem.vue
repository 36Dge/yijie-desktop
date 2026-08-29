<script setup lang="ts">
import { computed, useId } from "vue";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import type {
  ConversationSafeText,
  ConversationToolExecution,
  ConversationTruncationReason,
} from "../../domain/conversation-state";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import ChatCopyAction from "./ChatCopyAction.vue";
import ChatTimelineItemShell, {
  type ChatTimelineDisclosureChange,
} from "./ChatTimelineItemShell.vue";

type StatusTone = "muted" | "primary" | "success" | "warning" | "error";

const props = defineProps<{
  item: ConversationTimelineItemViewModel;
  execution: ConversationToolExecution;
}>();

const emit = defineEmits<{
  "disclosure-change": [change: ChatTimelineDisclosureChange];
}>();

const headingId = useId();
const argumentsHeadingId = `${headingId}-arguments`;
const resultHeadingId = `${headingId}-result`;

const statusPresentation = computed<Readonly<{
  label: string;
  summary: string;
  icon: YjIconName;
  tone: StatusTone;
}>>(() => {
  switch (props.execution.status) {
    case "in_progress":
      return { label: "执行中", summary: "工具正在执行。", icon: "pending", tone: "primary" };
    case "completed":
      return { label: "已完成", summary: "工具调用已完成。", icon: "check", tone: "success" };
    case "failed":
      return { label: "调用失败", summary: "工具调用失败。", icon: "warning", tone: "error" };
    case "declined":
      return { label: "已拒绝", summary: "工具调用未获执行。", icon: "stop", tone: "warning" };
    case "incomplete":
    default:
      return { label: "未完整结束", summary: "工具状态未完整结束。", icon: "warning", tone: "warning" };
  }
});

const defaultExpanded = computed(() => props.execution.status === "in_progress");
const identityLabel = computed(() => props.execution.identity.resolution === "known"
  ? `${props.execution.identity.serverName} · ${props.execution.identity.toolName}`
  : "未知工具");
const identityState = computed(() => props.execution.identity.resolution === "known"
  ? "已识别工具"
  : "工具身份尚未解析");
const durationLabel = computed(() => props.execution.durationMs === null
  ? null
  : formatDuration(props.execution.durationMs));
const resultStateMessage = computed(() => {
  if (props.execution.resultSummary !== null) return "工具返回的结果摘要为空。";
  return props.execution.status === "in_progress"
    ? "工具仍在执行，尚无结果摘要。"
    : "没有可显示的结果摘要。";
});

function truncationReasonLabel(reason: ConversationTruncationReason | null): string {
  return reason === "upstream_truncated" ? "上游仅提供了部分内容" : "已达到 UTF-8 字节限制";
}

function safeTextTruncation(summary: ConversationSafeText): string | null {
  return summary.truncated ? `内容已截断；${truncationReasonLabel(summary.truncationReason)}。` : null;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${durationMs} 毫秒`;
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(durationMs / 1_000)} 秒`;
}

function forwardDisclosure(change: ChatTimelineDisclosureChange): void {
  emit("disclosure-change", change);
}
</script>

<template>
  <ChatTimelineItemShell
    :item="item"
    label="工具调用"
    :status-label="statusPresentation.label"
    icon="skillOperations"
    :status-icon="statusPresentation.icon"
    :status-tone="statusPresentation.tone"
    collapsible
    :default-expanded="defaultExpanded"
    @disclosure-change="forwardDisclosure"
  >
    <span
      class="chat-tool-item__status-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >{{ statusPresentation.summary }}</span>

    <div class="chat-tool-item__details">
      <section class="chat-tool-item__identity" aria-label="工具身份">
        <div>
          <span>{{ identityState }}</span>
          <strong>{{ identityLabel }}</strong>
        </div>
        <span class="chat-tool-item__identity-badge">
          <YjIcon
            :name="execution.identity.resolution === 'known' ? 'check' : 'warning'"
            size="xs"
            :tone="execution.identity.resolution === 'known' ? 'success' : 'warning'"
          />
          {{ execution.identity.resolution === "known" ? "已识别" : "未知" }}
        </span>
      </section>

      <section class="chat-tool-item__section" :aria-labelledby="argumentsHeadingId">
        <header class="chat-tool-item__section-header">
          <h3 :id="argumentsHeadingId">参数摘要</h3>
          <ChatCopyAction
            v-if="execution.argumentsSummary.text"
            :adapter="browserChatClipboardAdapter"
            :text="execution.argumentsSummary.text"
          />
        </header>
        <p>{{ execution.argumentsSummary.text || "没有可显示的参数摘要。" }}</p>
        <p
          v-if="safeTextTruncation(execution.argumentsSummary)"
          class="chat-tool-item__notice"
          role="note"
        >
          <YjIcon name="warning" size="sm" tone="warning" />
          <span>{{ safeTextTruncation(execution.argumentsSummary) }}</span>
        </p>
      </section>

      <section v-if="execution.progress.length > 0" class="chat-tool-item__section">
        <h3>执行进度</h3>
        <ol class="chat-tool-item__progress" aria-label="工具执行进度">
          <li v-for="progress in execution.progress" :key="progress.sourceEventId">
            <YjIcon name="pending" size="xs" tone="muted" />
            <div>
              <strong>步骤 {{ progress.progressIndex + 1 }}</strong>
              <span>{{ progress.summary.text }}</span>
              <small v-if="safeTextTruncation(progress.summary)">
                {{ safeTextTruncation(progress.summary) }}
              </small>
            </div>
          </li>
        </ol>
      </section>

      <section class="chat-tool-item__section" :aria-labelledby="resultHeadingId">
        <header class="chat-tool-item__section-header">
          <h3 :id="resultHeadingId">结果摘要</h3>
          <ChatCopyAction
            v-if="execution.resultSummary?.text"
            :adapter="browserChatClipboardAdapter"
            :text="execution.resultSummary.text"
          />
        </header>
        <p v-if="execution.resultSummary?.text">{{ execution.resultSummary.text }}</p>
        <p v-else class="chat-tool-item__state" role="note">
          {{ resultStateMessage }}
        </p>
        <p
          v-if="execution.resultSummary && safeTextTruncation(execution.resultSummary)"
          class="chat-tool-item__notice"
          role="note"
        >
          <YjIcon name="warning" size="sm" tone="warning" />
          <span>{{ safeTextTruncation(execution.resultSummary) }}</span>
        </p>
      </section>

      <dl v-if="durationLabel" class="chat-tool-item__facts">
        <div>
          <dt>耗时</dt>
          <dd>{{ durationLabel }}</dd>
        </div>
      </dl>

      <div v-if="execution.error" class="chat-tool-item__error" role="note">
        <YjIcon name="warning" size="sm" tone="error" />
        <div>
          <strong>{{ execution.error.summary }}</strong>
          <code>{{ execution.error.code }}</code>
        </div>
      </div>

      <p class="chat-tool-item__capability-gap" role="note">
        <YjIcon name="warning" size="sm" tone="warning" />
        <span>当前仅展示安全的通用工具状态；真实工具能力仍待生产方确认。</span>
      </p>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.chat-tool-item__details,
.chat-tool-item__section,
.chat-tool-item__identity > div,
.chat-tool-item__error > div {
  display: grid;
  min-width: 0;
}

.chat-tool-item__details {
  gap: var(--yj-space-3);
}

.chat-tool-item__identity {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
}

.chat-tool-item__identity > div,
.chat-tool-item__section,
.chat-tool-item__error > div {
  gap: var(--yj-space-1);
}

.chat-tool-item__identity span,
.chat-tool-item__section h3,
.chat-tool-item__facts dt,
.chat-tool-item__progress strong,
.chat-tool-item__progress small,
.chat-tool-item__state,
.chat-tool-item__notice,
.chat-tool-item__error,
.chat-tool-item__error strong,
.chat-tool-item__error code,
.chat-tool-item__capability-gap {
  margin: var(--yj-space-0);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-tool-item__identity > div > span,
.chat-tool-item__section h3,
.chat-tool-item__facts dt,
.chat-tool-item__state,
.chat-tool-item__notice {
  color: var(--yj-color-text-tertiary);
}

.chat-tool-item__identity strong,
.chat-tool-item__section p,
.chat-tool-item__progress span,
.chat-tool-item__facts dd {
  min-width: 0;
  margin: var(--yj-space-0);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.chat-tool-item__identity-badge,
.chat-tool-item__section-header,
.chat-tool-item__notice,
.chat-tool-item__error,
.chat-tool-item__capability-gap {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--yj-space-2);
}

.chat-tool-item__identity-badge {
  flex: 0 0 auto;
  align-items: center;
  padding: var(--yj-space-1) var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
}

.chat-tool-item__section-header {
  align-items: center;
  justify-content: space-between;
}

.chat-tool-item__section h3 {
  font-weight: var(--yj-font-weight-semibold);
}

.chat-tool-item__progress {
  display: grid;
  max-height: calc(var(--yj-space-16) * 6);
  min-width: 0;
  margin: var(--yj-space-0);
  padding: var(--yj-space-0);
  gap: var(--yj-space-2);
  overflow: auto;
  list-style: none;
}

.chat-tool-item__progress li {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--yj-space-2);
}

.chat-tool-item__progress li > div {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-1);
}

.chat-tool-item__progress small {
  color: var(--yj-color-text-tertiary);
}

.chat-tool-item__facts {
  margin: var(--yj-space-0);
}

.chat-tool-item__facts div {
  display: flex;
  gap: var(--yj-space-2);
}

.chat-tool-item__facts dd {
  margin: var(--yj-space-0);
}

.chat-tool-item__error,
.chat-tool-item__capability-gap {
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
}

.chat-tool-item__error {
  color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-tool-item__error code {
  color: var(--yj-color-text-secondary);
  overflow-wrap: anywhere;
}

.chat-tool-item__error strong {
  overflow-wrap: anywhere;
}

.chat-tool-item__capability-gap {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-warning-soft);
}

.chat-tool-item__status-announcement {
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
  .chat-tool-item__identity {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
