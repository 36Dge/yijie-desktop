<script setup lang="ts">
import { computed, ref } from "vue";
import type {
  ChatAttachment,
  ChatAttachmentImportEvent,
  ChatProject,
} from "../../domain/chat-ipc";
import {
  inputValidationMessage,
  type ChatUiNotice,
} from "../../domain/chat-ui";
import YjIcon from "../yijie/YjIcon.vue";

const props = withDefaults(defineProps<{
  modelValue: string;
  mode: "new" | "reply";
  projects: readonly ChatProject[];
  selectedProjectId: string | null;
  activeProjectName?: string | null;
  readiness: ChatUiNotice;
  canSend: boolean;
  canAttach: boolean;
  sending: boolean;
  streaming: boolean;
  recoveryAvailable: boolean;
  attachments?: readonly ChatAttachment[];
  attachmentImportAttempt?: ChatAttachmentImportEvent | null;
  attachmentImporting?: boolean;
  attachmentErrorCode?: string | null;
  dragActive?: boolean;
}>(), {
  activeProjectName: null,
  attachments: () => Object.freeze([]),
  attachmentImportAttempt: null,
  attachmentImporting: false,
  attachmentErrorCode: null,
  dragActive: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "pick-project": [];
  "show-permission": [];
  submit: [];
  interrupt: [];
  recover: [];
  "pick-attachments": [];
  "remove-attachment": [attachmentId: string];
  "dismiss-attachment-import": [operationId: string];
  "unsupported-input": [message: string];
}>();

const composing = ref(false);
const selectedProject = computed(() => props.projects.find((project) =>
  project.projectId === props.selectedProjectId && project.available,
) ?? null);
const projectName = computed(() => props.mode === "new"
  ? selectedProject.value?.safeName ?? "选择本地项目"
  : props.activeProjectName ?? "本地项目");
const validationMessage = computed(() => {
  const message = inputValidationMessage(props.modelValue);
  return message === "请输入任务需求" && props.attachments.length > 0 ? null : message;
});
const visibleValidationMessage = computed(() => props.modelValue.length > 0 ? validationMessage.value : null);
const showReadiness = computed(() => props.readiness.tone !== "success" || props.readiness.actionLabel !== null);
const attachmentConstraintMessage = computed(() => {
  if (props.attachments.length > 10) return "每条消息最多添加 10 个附件。";
  const imageBytes = props.attachments
    .filter((attachment) => attachment.type === "image")
    .reduce((total, attachment) => total + attachment.sizeBytes, 0);
  return imageBytes > 10 * 1024 * 1024 ? "每条消息中的图片总大小不能超过 10 MB。" : null;
});
const sendDisabled = computed(() =>
  props.sending || props.streaming || !props.canSend || validationMessage.value !== null ||
  props.attachmentImporting || props.attachmentImportAttempt !== null ||
  props.attachments.some((attachment) => attachment.status !== "ready") ||
  attachmentConstraintMessage.value !== null ||
  (props.mode === "new" && selectedProject.value === null),
);
const sendLabel = computed(() => props.sending ? "正在提交" : "发送任务");
const attachmentButtonDisabled = computed(() =>
  !props.canSend || !props.canAttach || props.sending || props.streaming ||
  props.attachmentImporting || props.attachments.length >= 10,
);

const ATTACHMENT_STATUS_LABELS = Object.freeze({
  queued: "等待导入",
  importing: "正在导入",
  parsing: "正在解析",
  indexing: "正在建立索引",
  ready: "已就绪",
  bound: "已发送",
  error_terminal: "无法读取，请移除后重新选择",
  expired: "已过期",
});

function attachmentStatus(attachment: ChatAttachment): string {
  return ATTACHMENT_STATUS_LABELS[attachment.status];
}

function attachmentImportStatus(attempt: ChatAttachmentImportEvent): string {
  return ATTACHMENT_STATUS_LABELS[attempt.stage];
}

function attachmentImportDetails(attempt: ChatAttachmentImportEvent): string {
  return `${attempt.itemCount} 个附件 · ${attachmentImportStatus(attempt)}`;
}

const attachmentProgressAnnouncement = computed(() => {
  const attempt = props.attachmentImportAttempt;
  if (!attempt) return "正在处理附件";
  return `${attempt.itemCount} 个附件：${attachmentImportStatus(attempt)}`;
});

function attachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentErrorMessage(code: string | null): string | null {
  switch (code) {
    case "too_many": return "每条消息最多添加 10 个附件。";
    case "too_large": return "文件不能超过 10 MB。";
    case "archive_unsupported": return "暂不支持压缩包，请先解压后选择文件。";
    case "unsupported": return "不支持此文件格式，请选择常用文档或图片。";
    case "invalid_content":
    case "parse_failed": return "无法读取此文件，可移除后重新选择。";
    case "chat_limit_exceeded": return "每条消息最多添加 10 个附件，每个附件不能超过 10 MB。";
    case "chat_request_invalid": return "不支持此文件格式，请选择常用文档或图片。";
    case "chat_storage_unavailable": return "本机存储暂不可用，请释放空间后重新选择文件。";
    case null: return null;
    default: return "附件处理失败，请移除后重新选择。";
  }
}

function updateInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function submit(): void {
  if (!sendDisabled.value && !composing.value) emit("submit");
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || composing.value || event.isComposing) return;
  event.preventDefault();
  submit();
}

function handlePaste(event: ClipboardEvent): void {
  const containsFile = event.clipboardData?.files.length ||
    [...(event.clipboardData?.items ?? [])].some((item) => item.kind === "file");
  if (containsFile) {
    event.preventDefault();
    emit("unsupported-input", "请使用加号或拖拽添加图片与文件");
  }
}
</script>

<template>
  <section class="chat-composer" :class="`chat-composer--${mode}`" aria-label="任务输入区">
    <button
      v-if="mode === 'new'"
      class="chat-composer__project chat-composer__project--button"
      type="button"
      :disabled="sending || streaming"
      :aria-label="selectedProject ? `更换项目，当前项目 ${projectName}` : '选择本地项目'"
      :title="selectedProject ? `更换项目：${projectName}` : '选择本地项目'"
      @click="emit('pick-project')"
    >
      <YjIcon name="folder" size="sm" tone="muted" />
      <span class="chat-composer__project-name">{{ projectName }}</span>
    </button>
    <div v-else class="chat-composer__project" :aria-label="`当前聊天项目：${projectName}`">
      <YjIcon name="folder" size="sm" tone="muted" />
      <span class="chat-composer__project-name">{{ projectName }}</span>
    </div>

    <div
      v-if="showReadiness"
      class="chat-composer__readiness"
      :class="`chat-composer__readiness--${readiness.tone}`"
      role="status"
    >
      <span class="chat-composer__readiness-dot" aria-hidden="true" />
      <span class="chat-composer__readiness-copy">
        <strong>{{ readiness.title }}</strong>
        <span>{{ readiness.detail }}</span>
      </span>
      <button
        v-if="recoveryAvailable && readiness.actionLabel"
        class="chat-composer__recovery"
        type="button"
        :disabled="sending"
        @click="emit('recover')"
      >
        <YjIcon name="refresh" size="xs" />
        {{ readiness.actionLabel }}
      </button>
    </div>

    <div
      class="chat-composer__field"
      :class="{ 'chat-composer__field--drag-active': dragActive && !attachmentButtonDisabled }"
    >
      <label class="chat-composer__label" for="chat-task-input">输入你的任务需求</label>
      <ul
        v-if="attachments.length > 0 || attachmentImportAttempt"
        class="chat-composer__attachments"
        aria-label="待发送附件"
      >
        <li
          v-if="attachmentImportAttempt"
          :key="`import-${attachmentImportAttempt.operationId}`"
          class="chat-composer__attachment"
          :class="`chat-composer__attachment--${attachmentImportAttempt.stage}`"
        >
          <span class="chat-composer__attachment-icon" aria-hidden="true">
            <YjIcon name="file" size="sm" />
          </span>
          <span class="chat-composer__attachment-copy">
            <strong>{{ attachmentImportAttempt.itemCount }} 个附件</strong>
            <span>{{ attachmentImportDetails(attachmentImportAttempt) }}</span>
          </span>
          <span class="chat-composer__attachment-actions">
            <button
              v-if="attachmentImportAttempt.stage === 'error_terminal'"
              type="button"
              class="chat-composer__attachment-action"
              aria-label="移除失败的附件选择"
              title="移除失败的附件选择"
              :disabled="sending || attachmentImporting"
              @click="emit('dismiss-attachment-import', attachmentImportAttempt.operationId)"
            >
              <YjIcon name="dismiss" size="sm" />
            </button>
          </span>
        </li>
        <li
          v-for="attachment in attachments"
          :key="attachment.attachmentId"
          class="chat-composer__attachment"
          :class="`chat-composer__attachment--${attachment.status}`"
        >
          <span class="chat-composer__attachment-icon" aria-hidden="true">
            <YjIcon :name="attachment.type === 'image' ? 'image' : 'file'" size="sm" />
          </span>
          <span class="chat-composer__attachment-copy">
            <strong :title="attachment.name">{{ attachment.name }}</strong>
            <span>{{ attachmentSize(attachment.sizeBytes) }} · {{ attachmentStatus(attachment) }}</span>
          </span>
          <span class="chat-composer__attachment-actions">
            <button
              type="button"
              class="chat-composer__attachment-action"
              :aria-label="`移除 ${attachment.name}`"
              :title="`移除 ${attachment.name}`"
              :disabled="sending"
              @click="emit('remove-attachment', attachment.attachmentId)"
            >
              <YjIcon name="dismiss" size="sm" />
            </button>
          </span>
        </li>
      </ul>
      <textarea
        id="chat-task-input"
        class="chat-composer__textarea"
        :value="modelValue"
        :disabled="sending"
        :placeholder="mode === 'new' ? '描述你希望易界 AI 完成的任务…' : '继续输入任务需求…'"
        :aria-describedby="visibleValidationMessage ? 'chat-composer-validation' : undefined"
        :aria-invalid="visibleValidationMessage ? 'true' : undefined"
        autocomplete="off"
        spellcheck="true"
        @input="updateInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
      <div class="chat-composer__actions">
        <div class="chat-composer__leading-actions">
          <button
            class="chat-composer__add"
            type="button"
            :disabled="attachmentButtonDisabled"
            aria-label="添加图片或文件"
            title="添加图片或文件"
            @click="emit('pick-attachments')"
          >
            <YjIcon name="plus" size="lg" />
          </button>
          <button
            class="chat-composer__permission"
            type="button"
            aria-label="查看权限审批：只读访问，禁止写入"
            title="权限审批：只读访问，禁止写入"
            @click="emit('show-permission')"
          >
            <YjIcon name="shield" size="sm" tone="primary" />
            <span class="chat-composer__permission-label">权限审批</span>
            <span class="chat-composer__permission-value">只读 · 禁止写入</span>
          </button>
        </div>
        <button
          v-if="streaming"
          class="chat-composer__send chat-composer__send--stop"
          type="button"
          aria-label="停止生成"
          title="停止生成"
          @click="emit('interrupt')"
        >
          <YjIcon name="stop" size="lg" />
        </button>
        <button
          v-else
          class="chat-composer__send"
          type="button"
          :disabled="sendDisabled"
          :aria-label="sendLabel"
          :title="sendLabel"
          @click="submit"
        >
          <YjIcon name="send" size="lg" />
        </button>
      </div>
      <div v-if="dragActive && !attachmentButtonDisabled" class="chat-composer__drop-overlay" aria-hidden="true">
        <YjIcon name="plus" size="lg" />
        <span>松开以添加图片或文件</span>
      </div>
    </div>
    <p
      v-if="visibleValidationMessage"
      id="chat-composer-validation"
      class="chat-composer__validation"
      role="alert"
    >
      {{ visibleValidationMessage }}
    </p>
    <p
      v-if="attachmentImporting || (attachmentImportAttempt && !['ready', 'error_terminal'].includes(attachmentImportAttempt.stage))"
      class="chat-composer__attachment-progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span class="chat-composer__progress-dot" aria-hidden="true" />
      {{ attachmentProgressAnnouncement }}
    </p>
    <p v-if="attachmentErrorMessage(attachmentErrorCode)" class="chat-composer__validation" role="alert">
      {{ attachmentErrorMessage(attachmentErrorCode) }}
    </p>
    <p v-if="attachmentConstraintMessage" class="chat-composer__validation" role="alert">
      {{ attachmentConstraintMessage }}
    </p>
  </section>
</template>

<style scoped>
.chat-composer {
  width: min(100%, var(--yj-layout-chat-composer-max));
}

.chat-composer__project {
  position: relative;
  display: flex;
  width: calc(100% - var(--yj-space-6));
  min-height: var(--yj-space-12);
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-4);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-md);
  margin-inline: auto;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
  font: inherit;
  font-size: var(--yj-font-size-body);
  text-align: left;
}

.chat-composer__project--button {
  cursor: pointer;
  transition: border-color var(--yj-motion-fast) var(--yj-ease-standard), background var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-composer__project--button:hover:not(:disabled) {
  background: var(--yj-color-bg-subtle);
}

.chat-composer__project-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-composer__label {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip: rect(0 0 0 0);
  overflow: hidden;
  white-space: nowrap;
}

.chat-composer__permission,
.chat-composer__recovery {
  display: inline-flex;
  flex: none;
  min-height: var(--yj-space-8);
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) var(--yj-space-3);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-secondary);
  background: transparent;
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  white-space: nowrap;
}

.chat-composer__add,
.chat-composer__attachment-action {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: var(--yj-border-width) solid transparent;
  color: var(--yj-color-text-secondary);
  background: transparent;
}

.chat-composer__add {
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  border-radius: var(--yj-radius-full);
}

.chat-composer__add:hover:not(:disabled),
.chat-composer__attachment-action:hover:not(:disabled) {
  border-color: var(--yj-color-border-default);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-subtle);
}

.chat-composer__permission:hover,
.chat-composer__recovery:hover {
  border-color: var(--yj-color-border-default);
  background: var(--yj-color-bg-subtle);
}

.chat-composer__project--button:focus-visible,
.chat-composer__add:focus-visible,
.chat-composer__attachment-action:focus-visible,
.chat-composer__permission:focus-visible,
.chat-composer__recovery:focus-visible,
.chat-composer__send:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.chat-composer__project--button:focus-visible { z-index: 2; }

.chat-composer__permission-value {
  color: var(--yj-color-brand-text);
  font-weight: var(--yj-font-weight-semibold);
}

.chat-composer__readiness {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  margin-top: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
}

.chat-composer__readiness--success { background: var(--yj-color-success-soft); }
.chat-composer__readiness--warning { background: var(--yj-color-warning-soft); }
.chat-composer__readiness--error { background: var(--yj-color-error-soft); }

.chat-composer__readiness-dot {
  width: var(--yj-space-2);
  height: var(--yj-space-2);
  flex: 0 0 var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-icon-muted);
}

.chat-composer__readiness--success .chat-composer__readiness-dot { background: var(--yj-color-success); }
.chat-composer__readiness--warning .chat-composer__readiness-dot { background: var(--yj-color-warning); }
.chat-composer__readiness--error .chat-composer__readiness-dot { background: var(--yj-color-error); }

.chat-composer__readiness-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
  gap: 0 var(--yj-space-2);
}

.chat-composer__readiness-copy strong { color: var(--yj-color-text-primary); }

.chat-composer__recovery {
  flex: none;
  border-color: var(--yj-color-border-default);
  background: var(--yj-color-bg-card);
}

.chat-composer__field {
  position: relative;
  z-index: 1;
  margin-top: calc(var(--yj-space-2) * -1);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-card);
  transition: border-color var(--yj-motion-fast) var(--yj-ease-standard), box-shadow var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-composer__field:hover {
  border-color: var(--yj-color-border-default);
}

.chat-composer__readiness + .chat-composer__field { margin-top: var(--yj-space-2); }

.chat-composer__field:focus-within {
  border-color: var(--yj-color-brand-active);
  box-shadow: 0 0 0 var(--yj-space-1) var(--yj-color-brand-border), var(--yj-shadow-card);
}

.chat-composer__field--drag-active {
  border-color: var(--yj-color-brand-active);
  box-shadow: 0 0 0 var(--yj-space-1) var(--yj-color-brand-border), var(--yj-shadow-card);
}

.chat-composer__attachments {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--yj-space-2);
  padding: var(--yj-space-3) var(--yj-space-3) 0;
  margin: 0;
  list-style: none;
}

.chat-composer__attachment {
  display: grid;
  min-width: 0;
  min-height: var(--yj-space-12);
  grid-template-columns: var(--yj-space-8) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-subtle);
}

.chat-composer__attachment--error_terminal,
.chat-composer__attachment--expired {
  border-color: color-mix(in srgb, var(--yj-color-error) 32%, transparent);
  background: var(--yj-color-error-soft);
}

.chat-composer__attachment-icon {
  display: inline-flex;
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  align-items: center;
  justify-content: center;
  border-radius: var(--yj-radius-sm);
  color: var(--yj-color-brand-text);
  background: var(--yj-color-bg-card);
}

.chat-composer__attachment-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.chat-composer__attachment-copy strong {
  overflow: hidden;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-caption);
  font-weight: var(--yj-font-weight-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-composer__attachment-copy span {
  overflow: hidden;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-composer__attachment-actions {
  display: inline-flex;
  gap: var(--yj-space-1);
}

.chat-composer__attachment-action {
  width: var(--yj-space-8);
  height: var(--yj-space-8);
  border-radius: var(--yj-radius-sm);
}

.chat-composer__textarea {
  display: block;
  width: 100%;
  min-height: 136px;
  resize: none;
  box-sizing: border-box;
  padding: var(--yj-space-4) var(--yj-space-4) var(--yj-space-16);
  border: 0;
  border-radius: inherit;
  outline: none;
  color: var(--yj-color-text-primary);
  background: transparent;
  caret-color: var(--yj-color-brand-active);
  font: inherit;
  line-height: var(--yj-line-height-body);
}

.chat-composer--reply .chat-composer__textarea { min-height: 112px; }
.chat-composer__attachments + .chat-composer__textarea { min-height: 96px; padding-top: var(--yj-space-3); }
.chat-composer__textarea::placeholder { color: var(--yj-color-text-tertiary); opacity: 1; }

.chat-composer__actions {
  position: absolute;
  right: var(--yj-space-3);
  bottom: var(--yj-space-3);
  left: var(--yj-space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
  min-width: 0;
}

.chat-composer__leading-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-1);
}

.chat-composer__drop-overlay {
  position: absolute;
  z-index: 4;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--yj-space-2);
  border-radius: inherit;
  color: var(--yj-color-brand-text);
  background: color-mix(in srgb, var(--yj-color-bg-elevated) 92%, transparent);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  pointer-events: none;
}

.chat-composer__validation {
  margin: var(--yj-space-2) var(--yj-space-4) 0;
  color: var(--yj-color-error);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-composer__attachment-progress {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  margin: var(--yj-space-2) var(--yj-space-4) 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
}

.chat-composer__progress-dot {
  width: var(--yj-space-2);
  height: var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-brand-active);
}

.chat-composer__send {
  display: inline-flex;
  flex: 0 0 var(--yj-space-10);
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-on-accent);
  background: var(--yj-color-brand-active);
  box-shadow: var(--yj-shadow-xs);
}

.chat-composer__send:hover:not(:disabled) { background: var(--yj-color-brand-hover); }
.chat-composer__send:disabled { color: var(--yj-color-text-disabled); background: var(--yj-color-bg-subtle); cursor: not-allowed; }
.chat-composer__send--stop { color: var(--yj-color-error); background: var(--yj-color-error-soft); }

button:disabled { cursor: not-allowed; opacity: 0.64; }

@media (max-width: 560px) {
  .chat-composer__permission-value { display: none; }
  .chat-composer__attachments { grid-template-columns: minmax(0, 1fr); }
}

@media (max-width: 480px) {
  .chat-composer__permission {
    width: var(--yj-space-8);
    justify-content: center;
    padding: 0;
  }

  .chat-composer__permission-label { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .chat-composer__project--button,
  .chat-composer__field { transition: none; }
}
</style>
