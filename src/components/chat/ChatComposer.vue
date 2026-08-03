<script setup lang="ts">
import { computed, ref } from "vue";
import { NSelect } from "naive-ui";
import type { ChatProject } from "../../domain/chat-ipc";
import {
  inputByteLength,
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
  sending: boolean;
  streaming: boolean;
  recoveryAvailable: boolean;
}>(), {
  activeProjectName: null,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "update:selectedProjectId": [value: string | null];
  "pick-project": [];
  "show-permission": [];
  submit: [];
  interrupt: [];
  recover: [];
  "unsupported-input": [message: string];
}>();

const composing = ref(false);
const availableProjects = computed(() => props.projects.filter((project) => project.available));
const projectOptions = computed(() => availableProjects.value.map((project) => ({
  label: project.safeName,
  value: project.projectId,
})));
const validationMessage = computed(() => inputValidationMessage(props.modelValue));
const sendDisabled = computed(() =>
  props.sending || props.streaming || !props.canSend || validationMessage.value !== null ||
  (props.mode === "new" && props.selectedProjectId === null),
);
const byteCount = computed(() => inputByteLength(props.modelValue));
const sendLabel = computed(() => props.sending ? "正在提交" : "发送任务");

function updateInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function submit(): void {
  if (!sendDisabled.value && !composing.value) emit("submit");
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && event.metaKey && !composing.value) {
    event.preventDefault();
    submit();
  }
}

function handlePaste(event: ClipboardEvent): void {
  const containsFile = event.clipboardData?.files.length ||
    [...(event.clipboardData?.items ?? [])].some((item) => item.kind === "file");
  if (containsFile) {
    event.preventDefault();
    emit("unsupported-input", "当前只支持纯文本，不能粘贴文件或图片");
  }
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  emit("unsupported-input", "当前只支持纯文本，不能拖入文件或图片");
}
</script>

<template>
  <section class="chat-composer" :class="`chat-composer--${mode}`" aria-label="任务输入区">
    <div class="chat-composer__context">
      <div v-if="mode === 'new'" class="chat-composer__project-control">
        <label class="chat-composer__context-label" for="chat-project-select">聊天项目</label>
        <n-select
          id="chat-project-select"
          class="chat-composer__project-select"
          :value="selectedProjectId"
          :options="projectOptions"
          :disabled="sending || streaming"
          placeholder="选择已添加的项目"
          clearable
          @update:value="emit('update:selectedProjectId', $event)"
        />
        <button
          class="chat-composer__context-button"
          type="button"
          :disabled="sending || streaming"
          @click="emit('pick-project')"
        >
          <YjIcon name="folder" size="sm" />
          选择其他项目
        </button>
      </div>
      <div v-else class="chat-composer__active-project" aria-label="当前聊天项目">
        <YjIcon name="folder" size="sm" tone="muted" />
        <span>{{ activeProjectName ?? "本地项目" }}</span>
      </div>

      <button class="chat-composer__permission" type="button" @click="emit('show-permission')">
        <YjIcon name="shield" size="sm" tone="primary" />
        <span>权限审批</span>
        <span class="chat-composer__permission-value">只读 · 禁止写入</span>
      </button>
    </div>

    <div class="chat-composer__readiness" :class="`chat-composer__readiness--${readiness.tone}`">
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

    <div class="chat-composer__field" @dragover.prevent @drop="handleDrop">
      <label class="chat-composer__label" for="chat-task-input">输入你的任务需求</label>
      <textarea
        id="chat-task-input"
        class="chat-composer__textarea"
        :value="modelValue"
        :disabled="sending"
        :placeholder="mode === 'new' ? '描述你希望易界 AI 完成的任务…' : '继续输入任务需求…'"
        aria-describedby="chat-composer-hint chat-composer-validation"
        autocomplete="off"
        spellcheck="true"
        @input="updateInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
      <div class="chat-composer__footer">
        <span id="chat-composer-hint" class="chat-composer__hint">⌘ Enter 发送 · Enter 换行</span>
        <span
          id="chat-composer-validation"
          class="chat-composer__count"
          :class="{ 'chat-composer__count--error': validationMessage && modelValue.length > 0 }"
          aria-live="polite"
        >
          {{ validationMessage && modelValue.length > 0 ? validationMessage : `${byteCount} / 65536 字节` }}
        </span>
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
  </section>
</template>

<style scoped>
.chat-composer {
  width: min(100%, var(--yj-layout-chat-composer-max));
  padding: var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-xl);
  background: color-mix(in srgb, var(--yj-color-bg-card) 94%, transparent);
  box-shadow: var(--yj-shadow-card);
}

.chat-composer__context {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
  padding: var(--yj-space-1) var(--yj-space-1) var(--yj-space-3);
}

.chat-composer__project-control {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: var(--yj-space-2);
}

.chat-composer__context-label,
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

.chat-composer__project-select {
  min-width: 180px;
  max-width: 320px;
}

.chat-composer__context-button,
.chat-composer__permission,
.chat-composer__active-project,
.chat-composer__recovery {
  display: inline-flex;
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
}

.chat-composer__context-button:hover,
.chat-composer__permission:hover,
.chat-composer__recovery:hover {
  border-color: var(--yj-color-border-default);
  background: var(--yj-color-bg-subtle);
}

.chat-composer__context-button:focus-visible,
.chat-composer__permission:focus-visible,
.chat-composer__recovery:focus-visible,
.chat-composer__send:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.chat-composer__permission-value {
  color: var(--yj-color-brand-text);
  font-weight: var(--yj-font-weight-semibold);
}

.chat-composer__readiness {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
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
  margin-top: var(--yj-space-3);
}

.chat-composer__textarea {
  display: block;
  width: 100%;
  min-height: 112px;
  resize: none;
  padding: var(--yj-space-4) var(--yj-space-12) var(--yj-space-10) var(--yj-space-4);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  outline: none;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-page);
  caret-color: var(--yj-color-brand-active);
  font: inherit;
  line-height: var(--yj-line-height-body);
  transition: border-color var(--yj-motion-fast) var(--yj-ease-standard), box-shadow var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-composer--reply .chat-composer__textarea { min-height: 92px; }
.chat-composer__textarea::placeholder { color: var(--yj-color-text-tertiary); opacity: 1; }
.chat-composer__textarea:hover { border-color: var(--yj-color-border-strong); }
.chat-composer__textarea:focus {
  border-color: var(--yj-color-brand-active);
  box-shadow: 0 0 0 var(--yj-space-1) var(--yj-color-brand-border);
}

.chat-composer__footer {
  position: absolute;
  right: var(--yj-space-12);
  bottom: var(--yj-space-3);
  left: var(--yj-space-4);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-3);
  pointer-events: none;
}

.chat-composer__hint,
.chat-composer__count {
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.chat-composer__count--error { color: var(--yj-color-error); }

.chat-composer__send {
  position: absolute;
  right: var(--yj-space-3);
  bottom: var(--yj-space-3);
  display: inline-flex;
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

@media (max-width: 900px) {
  .chat-composer__context { align-items: stretch; flex-direction: column; }
  .chat-composer__project-control { width: 100%; }
  .chat-composer__permission { align-self: flex-start; }
}

@media (prefers-reduced-motion: reduce) {
  .chat-composer__textarea { transition: none; }
}
</style>
