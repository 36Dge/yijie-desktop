<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import { browserChatClipboardAdapter } from "../../api/chat-clipboard-adapter";
import { parseStrictRfc3339EpochNanoseconds } from "../../domain/rfc3339";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "../yijie/YjIcon.vue";
import ChatCopyAction from "./ChatCopyAction.vue";

defineOptions({ inheritAttrs: false });

export type ChatApprovalCardStatus =
  | "pending"
  | "submitting"
  | "reconciling"
  | "accepted"
  | "cancelled"
  | "expired"
  | "resolved_elsewhere"
  | "disconnected"
  | "error";

export type ChatApprovalDecision = "accept_once" | "cancel_current_turn";

export type ChatApprovalErrorCode =
  | "invalid_approval_request"
  | "approval_version_mismatch"
  | "unauthorized"
  | "session_not_found"
  | "approval_not_found"
  | "approval_stale"
  | "approval_expired"
  | "approval_already_resolved"
  | "approval_decision_conflict"
  | "approval_unavailable"
  | "internal_error"
  | "unknown";

type StatusPresentation = Readonly<{
  label: string;
  summary: string;
  icon: YjIconName;
  tone: "muted" | "primary" | "success" | "warning" | "error";
}>;

export type ChatApprovalDecisionRequest = Readonly<{
  approvalRequestId: string;
  decision: ChatApprovalDecision;
}>;

const props = withDefaults(defineProps<{
  approvalRequestId: string;
  status: ChatApprovalCardStatus;
  expiresAt: string;
  actionable?: boolean;
  authorityRevision?: number;
  errorCode?: ChatApprovalErrorCode | null;
}>(), {
  actionable: false,
  authorityRevision: 0,
  errorCode: null,
});

const emit = defineEmits<{
  decision: [request: ChatApprovalDecisionRequest];
}>();

const actionLabel = "检查当前工作区是否为 Git 仓库";
const workspaceLabel = "当前工作区";
const titleId = `${useId()}-title`;
const decisionLocked = ref(false);
const cardElement = ref<HTMLElement | null>(null);
const nowEpochMs = ref(Date.now());
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let consumedAuthorityRevision = props.authorityRevision;

const statusPresentation = computed<StatusPresentation>(() => {
  switch (props.status) {
    case "pending":
      return {
        label: "等待确认",
        summary: "只读工作区检查正在等待你的确认。",
        icon: "pending",
        tone: "warning",
      };
    case "submitting":
      return {
        label: "正在提交",
        summary: "正在等待 Host 和 Runtime 确认决定。",
        icon: "pending",
        tone: "primary",
      };
    case "reconciling":
      return {
        label: "正在核对",
        summary: "正在从 Host 核对最新待确认状态，操作保持禁用。",
        icon: "refresh",
        tone: "primary",
      };
    case "accepted":
      return {
        label: "已允许一次",
        summary: "本次允许决定已确认，命令结果仍以执行终态为准。",
        icon: "check",
        tone: "success",
      };
    case "cancelled":
      return {
        label: "已取消本轮",
        summary: "取消本轮的决定已确认，当前轮将按权威终态结束。",
        icon: "stop",
        tone: "warning",
      };
    case "expired":
      return {
        label: "确认已过期",
        summary: "确认有效期已结束，此操作不可再用。",
        icon: "pending",
        tone: "muted",
      };
    case "resolved_elsewhere":
      return {
        label: "已由运行状态解决",
        summary: "此确认已由运行状态变化解决，不可再操作。",
        icon: "check",
        tone: "muted",
      };
    case "disconnected":
      return {
        label: "连接已中断",
        summary: "连接恢复并核对最新待确认状态前，操作保持禁用。",
        icon: "warning",
        tone: "warning",
      };
    case "error":
    default:
      return {
        label: "暂时无法确认",
        summary: approvalErrorMessage(props.errorCode),
        icon: "warning",
        tone: "error",
      };
  }
});

const expiryNanoseconds = computed(() =>
  parseStrictRfc3339EpochNanoseconds(props.expiresAt));
const expiry = computed(() => {
  const nanoseconds = expiryNanoseconds.value;
  if (nanoseconds === null) {
    return Object.freeze({ valid: false, label: "有效时间不可用" });
  }
  const date = new Date(Number(nanoseconds / NANOSECONDS_PER_MILLISECOND));
  return Object.freeze({
    valid: true,
    label: new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date),
  });
});

const locallyExpired = computed(() => {
  const expiresAt = expiryNanoseconds.value;
  return expiresAt === null ||
    BigInt(Math.trunc(nowEpochMs.value)) * NANOSECONDS_PER_MILLISECOND >= expiresAt;
});
const decisionEnabled = computed(() =>
  props.status === "pending" && props.actionable && !locallyExpired.value &&
  !decisionLocked.value);
const copyText = computed(() => [
  `确认操作：${actionLabel}`,
  `影响范围：${workspaceLabel}`,
  `状态：${statusPresentation.value.label}`,
  `有效期至：${expiry.value.label}`,
].join("\n"));

watch(
  () => props.approvalRequestId,
  () => {
    decisionLocked.value = false;
    consumedAuthorityRevision = props.authorityRevision;
  },
);

watch(
  [() => props.status, () => props.actionable, () => props.authorityRevision],
  ([status, actionable, authorityRevision]) => {
    if (status === "pending" && actionable &&
        authorityRevision !== consumedAuthorityRevision) {
      // Only the parent can re-establish actionable=true after a fresh Host
      // authority snapshot. A transport result never unlocks this card.
      decisionLocked.value = false;
      consumedAuthorityRevision = authorityRevision;
    }
  },
);

function clearExpiryTimer(): void {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function scheduleExpiryCheck(): void {
  clearExpiryTimer();
  nowEpochMs.value = Date.now();
  if (props.status !== "pending" || !props.actionable) return;
  const expiresAt = expiryNanoseconds.value;
  if (expiresAt === null || locallyExpired.value) return;
  const expiryEpochMs = (expiresAt + NANOSECONDS_PER_MILLISECOND - 1n) /
    NANOSECONDS_PER_MILLISECOND;
  const remainingMs = expiryEpochMs - BigInt(Date.now());
  const delay = Number(remainingMs > BigInt(MAX_TIMER_DELAY_MS)
    ? BigInt(MAX_TIMER_DELAY_MS)
    : remainingMs);
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    scheduleExpiryCheck();
  }, Math.max(0, delay));
}

watch(
  [() => props.expiresAt, () => props.status, () => props.actionable],
  scheduleExpiryCheck,
  { immediate: true },
);

onBeforeUnmount(clearExpiryTimer);

watch(
  () => props.status,
  async (status, previous) => {
    if (
      status === previous || status === "pending" ||
      status === "submitting" || status === "reconciling"
    ) return;
    const card = cardElement.value;
    if (card === null || !card.contains(card.ownerDocument.activeElement)) return;
    await nextTick();
    card.focus({ preventScroll: true });
  },
);

function approvalErrorMessage(code: ChatApprovalErrorCode | null): string {
  switch (code) {
    case "approval_version_mismatch":
      return "审批版本不兼容。请更新应用后重新核对状态。";
    case "unauthorized":
      return "当前身份无法确认此操作。请重新进入本地会话后核对状态。";
    case "approval_expired":
      return "确认已经过期。请等待界面同步最新状态。";
    case "session_not_found":
    case "approval_not_found":
    case "approval_stale":
    case "approval_already_resolved":
    case "approval_decision_conflict":
      return "确认状态已经变化。请等待界面同步最新状态。";
    case "invalid_approval_request":
      return "确认请求无效，操作已停止。";
    case "approval_unavailable":
    case "internal_error":
    case "unknown":
    case null:
    default:
      return "暂时无法确认。请等待连接恢复并核对最新状态。";
  }
}

function decide(decision: ChatApprovalDecision): void {
  nowEpochMs.value = Date.now();
  if (!decisionEnabled.value) return;
  decisionLocked.value = true;
  emit("decision", Object.freeze({
    approvalRequestId: props.approvalRequestId,
    decision,
  }));
}
</script>

<template>
  <section
    ref="cardElement"
    class="chat-approval-card"
    :class="`chat-approval-card--${status}`"
    :aria-labelledby="titleId"
    :aria-busy="status === 'submitting' || status === 'reconciling' ? 'true' : 'false'"
    tabindex="-1"
  >
    <header class="chat-approval-card__header">
      <span class="chat-approval-card__identity">
        <YjIcon name="shield" size="sm" tone="primary" />
        <strong :id="titleId">需要确认</strong>
      </span>
      <span class="chat-approval-card__status">
        <YjIcon
          :name="statusPresentation.icon"
          size="xs"
          :tone="statusPresentation.tone"
        />
        <span>{{ statusPresentation.label }}</span>
      </span>
      <ChatCopyAction
        :adapter="browserChatClipboardAdapter"
        :text="copyText"
        kind="text"
      />
    </header>

    <div class="chat-approval-card__body">
      <div class="chat-approval-card__summary">
        <strong>{{ actionLabel }}</strong>
        <p>仅执行只读检查，不会修改文件，也不会访问网络。</p>
      </div>

      <dl class="chat-approval-card__facts">
        <div>
          <dt>影响范围</dt>
          <dd>{{ workspaceLabel }}</dd>
        </div>
        <div>
          <dt>有效期至</dt>
          <dd>
            <time v-if="expiry.valid" :datetime="expiresAt">{{ expiry.label }}</time>
            <span v-else>{{ expiry.label }}</span>
          </dd>
        </div>
      </dl>

      <p class="chat-approval-card__state" role="note">
        {{ statusPresentation.summary }}
      </p>

      <p class="chat-approval-card__action-hint">
        “允许一次”仅适用于本次只读检查；“取消本轮”会停止当前轮。
      </p>

      <div class="chat-approval-card__actions" role="group" aria-label="确认决定">
        <button
          class="chat-approval-card__button chat-approval-card__button--primary"
          type="button"
          :disabled="!decisionEnabled"
          @click="decide('accept_once')"
        >
          允许一次
        </button>
        <button
          class="chat-approval-card__button chat-approval-card__button--secondary"
          type="button"
          :disabled="!decisionEnabled"
          @click="decide('cancel_current_turn')"
        >
          取消本轮
        </button>
      </div>

      <span
        class="chat-approval-card__announcement"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >{{ statusPresentation.summary }}</span>
    </div>
  </section>
</template>

<style scoped>
.chat-approval-card {
  display: grid;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  overflow: hidden;
}

.chat-approval-card--pending {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}

.chat-approval-card--submitting,
.chat-approval-card--reconciling {
  border-color: var(--yj-color-brand-border);
  background: var(--yj-color-brand-soft);
}

.chat-approval-card--accepted {
  border-color: var(--yj-color-success);
  background: var(--yj-color-success-soft);
}

.chat-approval-card--cancelled,
.chat-approval-card--disconnected {
  border-color: var(--yj-color-warning);
  background: var(--yj-color-warning-soft);
}

.chat-approval-card--error {
  border-color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.chat-approval-card:focus {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.chat-approval-card__header {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.chat-approval-card__identity,
.chat-approval-card__status {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-approval-card__status {
  justify-content: flex-end;
  color: var(--yj-color-text-secondary);
}

.chat-approval-card__status span,
.chat-approval-card__summary,
.chat-approval-card__facts dd,
.chat-approval-card__state {
  overflow-wrap: anywhere;
}

.chat-approval-card__body,
.chat-approval-card__summary {
  display: grid;
  min-width: 0;
}

.chat-approval-card__body {
  gap: var(--yj-space-3);
  padding: var(--yj-space-3);
}

.chat-approval-card__summary {
  gap: var(--yj-space-1);
}

.chat-approval-card__summary strong,
.chat-approval-card__summary p,
.chat-approval-card__state,
.chat-approval-card__action-hint {
  margin: var(--yj-space-0);
}

.chat-approval-card__summary strong {
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.chat-approval-card__summary p,
.chat-approval-card__state,
.chat-approval-card__action-hint,
.chat-approval-card__facts {
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-approval-card__facts {
  display: grid;
  min-width: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: var(--yj-space-0);
  gap: var(--yj-space-2) var(--yj-space-4);
}

.chat-approval-card__facts > div {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-1);
}

.chat-approval-card__facts dt {
  color: var(--yj-color-text-tertiary);
  font-weight: var(--yj-font-weight-semibold);
}

.chat-approval-card__facts dd {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-primary);
}

.chat-approval-card__actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--yj-space-2);
}

.chat-approval-card__button {
  min-width: calc(var(--yj-space-16) * 2);
  min-height: var(--yj-space-10);
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-md);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.chat-approval-card__button--primary {
  color: var(--yj-color-text-on-accent);
  background: var(--yj-color-brand-primary);
}

.chat-approval-card__button--primary:hover:not(:disabled) {
  background: var(--yj-color-brand-hover);
}

.chat-approval-card__button--primary:active:not(:disabled) {
  background: var(--yj-color-brand-active);
}

.chat-approval-card__button--secondary {
  border-color: var(--yj-color-border-default);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
}

.chat-approval-card__button--secondary:hover:not(:disabled) {
  border-color: var(--yj-color-border-strong);
  background: var(--yj-color-bg-subtle);
}

.chat-approval-card__button:disabled {
  border-color: var(--yj-color-border-subtle);
  color: var(--yj-color-text-disabled);
  background: var(--yj-color-bg-subtle);
  cursor: default;
}

.chat-approval-card__button:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.chat-approval-card__announcement {
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
  .chat-approval-card__header,
  .chat-approval-card__facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .chat-approval-card__status {
    justify-content: flex-start;
  }

  .chat-approval-card__actions,
  .chat-approval-card__button {
    width: 100%;
  }
}
</style>
