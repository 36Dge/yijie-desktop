<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
  WORKFLOW_EDITOR_URL,
  WorkflowEditorChannel,
} from "../../api/workflow-editor-channel";
import {
  workflowNativeClient,
  workflowFailure,
  type EditorOpenedView,
  type WorkflowNativeError,
  type WorkflowSchemas,
} from "../../api/workflow-native-client";

const props = defineProps<{
  fullPage?: boolean;
  view: EditorOpenedView;
  reconnecting: boolean;
  closing: boolean;
  dirty: boolean;
  pendingWrites: number;
  parentFailure: WorkflowNativeError | null;
}>();
const emit = defineEmits<{
  close: [];
  history: [];
  reconnect: [];
  dirty: [value: boolean];
  result: [value: WorkflowSchemas["EditorExchangeResult"]];
  failure: [value: WorkflowNativeError];
  busy: [writes: number];
  renewed: [value: EditorOpenedView];
}>();

const frame = ref<HTMLIFrameElement | null>(null);
const reconnectButton = ref<HTMLButtonElement | null>(null);
const ready = ref(false);
const failure = shallowRef<WorkflowNativeError | null>(null);
const loaded = ref(false);
let connection: WorkflowEditorChannel | null = null;
const visibleFailure = computed(() => props.parentFailure ?? failure.value);
const interrupted = computed(() => ["service_unavailable", "protocol_mismatch", "session_expired", "unauthorized", "resource_not_found"].includes(visibleFailure.value?.code ?? ""));
const bootstrapFailed = computed(() => !ready.value && visibleFailure.value !== null);
const recoveryRequired = computed(() => interrupted.value || bootstrapFailed.value);
const blocked = computed(() => !ready.value || recoveryRequired.value || props.reconnecting || props.closing);
const canReconnect = computed(() => recoveryRequired.value && !props.closing && !props.reconnecting && props.pendingWrites === 0);

watch(canReconnect, async (allowed) => {
  if (allowed) {
    await nextTick();
    reconnectButton.value?.focus();
  }
});

function bind() {
  if (!loaded.value || !frame.value) return;
  // Credential rotation belongs to the current page channel; do not reload or
  // rebootstrap the iframe and overwrite its in-memory editing state.
  if (connection?.ownsView(props.view)) return;
  connection?.close();
  ready.value = false;
  failure.value = null;
  let binding: WorkflowEditorChannel;
  const current = () => connection === binding && binding.ownsView(props.view);
  try {
    binding = new WorkflowEditorChannel(frame.value, props.view, workflowNativeClient, {
      ready: () => { /* The real bootstrap result marks the editor usable. */ },
      dirty: (value) => { if (current()) emit("dirty", value); },
      requestClose: () => { if (current()) emit("close"); },
      requestHistory: () => { if (current()) emit("history"); },
      result: (value) => {
        if (!current()) return;
        if (value.bootstrap) ready.value = true;
        failure.value = null;
        emit("result", value);
      },
      failure: (value) => {
        if (!current()) return;
        failure.value = value;
        emit("failure", value);
      },
      busy: (count) => { if (current()) emit("busy", count); },
      renewed: (view) => { if (current()) emit("renewed", view); },
    });
    connection = binding;
  } catch (error) {
    failure.value = workflowFailure(error);
    emit("failure", failure.value);
  }
}

function frameLoaded() {
  loaded.value = true;
  bind();
}

function reconnect() {
  if (!canReconnect.value) return;
  connection?.close();
  connection = null;
  emit("reconnect");
}

// Only the binding changes during reconnect; the iframe DOM and draft stay alive.
watch([() => props.view.bridge_id, () => props.view.generation], bind, { flush: "post" });
onBeforeUnmount(() => {
  connection?.close();
});
</script>

<template>
  <section class="workflow-editor-pane" :class="{ 'workflow-editor-pane--full': fullPage }" aria-label="工作流编辑器" :aria-busy="reconnecting || closing || !ready">
    <header v-if="!fullPage" class="workflow-editor-pane__header">
      <button type="button" class="workflow-showcase-control yj-control" :disabled="closing" @click="emit('close')">
        返回工作流
      </button>
      <div class="workflow-editor-pane__heading">
        <component :is="fullPage ? 'h1' : 'h2'">{{ view.workflow.name }}</component>
        <span class="workflow-editor-pane__meta">{{ dirty ? '未保存的修改' : '草稿已读取' }}</span>
      </div>
      <span class="workflow-editor-pane__meta">{{ ready ? '编辑器已连接' : '正在连接编辑器…' }}</span>
      <slot name="actions" />
    </header>

    <div v-if="visibleFailure && !interrupted" class="workflow-editor-pane__notice" role="alert">{{ visibleFailure.message }}</div>
    <div class="workflow-editor-pane__canvas">
      <iframe ref="frame" :src="WORKFLOW_EDITOR_URL" title="Coze 工作流画布"
        sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
        :tabindex="blocked ? -1 : 0" :inert="blocked" :class="{ 'workflow-editor-pane__frame--blocked': blocked }"
        @load="frameLoaded" />
      <div v-if="blocked" class="workflow-editor-pane__overlay">
        <div class="workflow-editor-pane__notice" role="status">
          <strong>{{ closing ? '正在关闭编辑会话…' : reconnecting ? '正在重新连接…' : recoveryRequired ? '编辑器连接暂不可用' : '正在连接编辑器…' }}</strong>
          <p v-if="recoveryRequired">当前画布和未保存内容仍保留在此页面，重新连接后可继续编辑。</p>
          <p v-else-if="!closing">正在读取并核对服务端草稿，请稍候。</p>
          <p v-if="parentFailure" role="alert">{{ parentFailure.message }}</p>
          <p v-if="pendingWrites">正在确认已发出的操作，结果返回后再重新连接。</p>
          <button v-if="recoveryRequired && !closing" ref="reconnectButton" type="button" class="workflow-showcase-control yj-control workflow-editor-pane__primary"
            :disabled="!canReconnect" @click="reconnect">{{ reconnecting ? '正在连接…' : '重新连接' }}</button>
          <button v-if="fullPage" type="button" class="workflow-showcase-control yj-control"
            :disabled="closing" @click="emit('close')">返回工作流</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workflow-editor-pane { display: grid; gap: var(--yj-space-3); min-width: 0; }
.workflow-editor-pane__header { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-3); }
.workflow-editor-pane__heading { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--yj-space-2); flex: 1; min-width: 0; }
.workflow-editor-pane__heading :is(h1, h2) { margin: 0; font-size: var(--yj-font-size-section-title); line-height: var(--yj-line-height-section-title); overflow-wrap: anywhere; }
.workflow-editor-pane__meta { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.workflow-editor-pane__canvas { position: relative; height: max(calc(var(--yj-space-16) * 8), calc(100vh - var(--yj-space-16) * 3)); min-width: 0; }
.workflow-editor-pane iframe { display: block; width: 100%; height: 100%; border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.workflow-editor-pane__frame--blocked { pointer-events: none; }
.workflow-editor-pane__overlay { position: absolute; inset: 0; display: grid; align-content: start; justify-items: center; padding: var(--yj-space-5); }
.workflow-editor-pane__notice { padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); color: var(--yj-color-text-body); }
.workflow-editor-pane__notice p { margin: var(--yj-space-2) 0 var(--yj-space-3); }
.workflow-editor-pane__primary { background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); }
.workflow-editor-pane__primary:hover { background: var(--yj-color-brand-hover); }

.workflow-editor-pane--full { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 0; }
.workflow-editor-pane--full .workflow-editor-pane__canvas { flex: 1; height: auto; min-height: 0; }
.workflow-editor-pane--full iframe { border: 0; border-radius: 0; }
</style>
