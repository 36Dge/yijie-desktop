<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from "vue-router";
import { NModal } from "naive-ui";
import { useWorkflowWorkspace } from "../../pages/workflows/use-workflow-workspace";
import { useWorkflowRuns } from "../../pages/workflows/use-workflow-runs";
import type { WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowEditorPane from "./WorkflowEditorPane.vue";
import WorkflowRunPanel from "./WorkflowRunPanel.vue";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjPageHeader from "../yijie/YjPageHeader.vue";

const props = defineProps<{ workflowId: string }>();
const router = useRouter();
const state = useWorkflowWorkspace();
const { error, loading, creating, opening, openPending, reconnecting, closing,
  editor, dirty, pendingWrites } = state;
const runs = useWorkflowRuns(editor);
const { submitting: running, pending: uncertainRun } = runs;
const showHistory = ref(false);
const confirmClose = ref(false);
const leaveMessage = ref("");
let finishLeave: ((allowed: boolean) => void) | undefined;
async function start(workflowId: string) {
  if (workflowId === "new") {
    await router.replace({ path: "/workflows", query: { create: "1" } });
    return;
  }
  await state.openWorkflow(workflowId);
}
onMounted(() => { void start(props.workflowId); });
watch(() => props.workflowId, id => { void start(id); });
onBeforeUnmount(() => { finishLeave?.(false); });

function acceptResult(result: WorkflowSchemas["EditorExchangeResult"]) {
  state.acceptEditorResult(result);
  if (result.run) runs.accept(result.run);
}
function askToClose(): Promise<boolean> {
  leaveMessage.value = "";
  if (pendingWrites.value || creating.value || reconnecting.value || closing.value || running.value) {
    leaveMessage.value = "操作正在进行，请等待真实结果后再返回。";
    return Promise.resolve(false);
  }
  if (!dirty.value && !uncertainRun.value) return Promise.resolve(true);
  if (finishLeave) return Promise.resolve(false);
  confirmClose.value = true;
  return new Promise(resolve => { finishLeave = resolve; });
}
function decideClose(allowed: boolean) {
  confirmClose.value = false;
  finishLeave?.(allowed);
  finishLeave = undefined;
}
async function leaveEditor() {
  if (!(await askToClose())) return false;
  if (openPending.value) await state.cancelOpening();
  if (editor.value) {
    await state.closeEditor();
    if (editor.value) return false;
  }
  showHistory.value = false;
  return true;
}
onBeforeRouteLeave(leaveEditor);
onBeforeRouteUpdate(leaveEditor);
function requestClose() { void router.push({ name: "workflows" }); }
</script>

<template>
  <div class="workflow-local-workspace">
    <p v-if="leaveMessage" class="workflow-local-workspace__notice" role="status">{{ leaveMessage }}</p>
    <WorkflowEditorPane v-if="editor" :key="editor.workflow.workflow_id" :view="editor" full-page
      :reconnecting="reconnecting" :closing="closing" :dirty="dirty" :pending-writes="pendingWrites" :parent-failure="error"
      @close="requestClose" @history="showHistory = true" @reconnect="state.openWorkflow(editor.workflow.workflow_id, true)"
      @dirty="dirty = $event" @busy="pendingWrites = $event"
      @result="acceptResult" @failure="state.acceptEditorFailure" />
    <div v-else class="workflow-local-workspace__landing">
      <YjPageHeader :title="workflowId === 'new' ? '创建工作流' : '打开工作流'">
        <template #actions><button type="button" class="workflow-showcase-control yj-control" @click="requestClose">返回工作流</button></template>
      </YjPageHeader>
      <p v-if="error" class="workflow-local-workspace__notice" role="alert">{{ error.message }}</p>
      <p v-if="creating || loading || opening" role="status">{{ creating ? '正在创建工作流…' : opening ? '正在读取工作流并建立编辑会话…' : '正在连接工作流服务…' }}</p>
      <button v-if="opening" type="button" class="workflow-showcase-control yj-control" @click="requestClose">取消打开</button>
      <YjEmpty v-if="!creating && !loading && !openPending" title="暂时无法打开工作流"
        description="确认本地工作流服务已启动后重试。已创建的流程会保留，重试打开不会重复创建。" icon="workflow">
        <template #actions><button type="button" class="workflow-showcase-control yj-control" @click="start(workflowId)">重新连接</button></template>
      </YjEmpty>
    </div>

    <NModal v-model:show="showHistory" preset="card" title="版本与运行记录" class="workflow-local-history" :bordered="false" :closable="false" role="dialog" aria-label="版本与运行记录"
      :style="{ width: 'min(var(--yj-layout-form-max), calc(100vw - var(--yj-space-8)))', maxHeight: 'calc(100vh - var(--yj-space-8))', overflow: 'auto' }">
      <template #header-extra><button type="button" class="workflow-showcase-control yj-control" aria-label="关闭运行记录" @click="showHistory = false">关闭</button></template>
      <WorkflowRunPanel v-if="editor" :state="runs" :latest-version="editor.workflow.published_version"
        :busy="pendingWrites > 0 || reconnecting || closing" />
    </NModal>
    <NModal :show="confirmClose" preset="dialog" title="有未保存或待确认的内容" :show-icon="false"
      :mask-closable="false" :closable="false" @esc="decideClose(false)">
      <p>继续编辑会保留当前画布和原操作查询入口。返回将关闭编辑会话并丢弃本地内容及待确认操作的查询入口；已经提交的操作不会因此撤销，运行历史仍保留在服务端。</p>
      <template #action>
        <button type="button" class="workflow-showcase-control yj-control" @click="decideClose(false)">继续编辑</button>
        <button type="button" class="workflow-showcase-control yj-control" @click="decideClose(true)">放弃本地内容并返回</button>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.workflow-local-workspace { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; }
.workflow-local-workspace__landing { padding: var(--yj-space-6); display: grid; align-content: start; gap: var(--yj-space-5); }
.workflow-local-workspace__notice { flex: none; margin: 0; padding: var(--yj-space-3); border-bottom: var(--yj-border-width) solid var(--yj-color-border-default); color: var(--yj-color-text-body); }
</style>
