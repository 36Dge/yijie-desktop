<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from "vue-router";
import { NModal } from "naive-ui";
import { useWorkflowWorkspace } from "../../pages/workflows/use-workflow-workspace";
import WorkflowEditorPane from "./WorkflowEditorPane.vue";
import WorkflowOpeningPlaceholder from "./WorkflowOpeningPlaceholder.vue";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjPageHeader from "../yijie/YjPageHeader.vue";

const props = defineProps<{ workflowId: string }>();
const router = useRouter();
const state = useWorkflowWorkspace();
const { error, loading, creating, opening, openPending, reconnecting, closing,
  editor, dirty, pendingWrites } = state;
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

function askToClose(): Promise<boolean> {
  leaveMessage.value = "";
  if (pendingWrites.value || creating.value || reconnecting.value || closing.value) {
    leaveMessage.value = "操作正在进行，请等待真实结果后再返回。";
    return Promise.resolve(false);
  }
  if (!dirty.value) return Promise.resolve(true);
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
      @close="requestClose" @reconnect="state.openWorkflow(editor.workflow.workflow_id, true)"
      @dirty="dirty = $event" @busy="pendingWrites = $event"
      @renewed="state.acceptEditorRenewal"
      @result="state.acceptEditorResult" @failure="state.acceptEditorFailure" />
    <WorkflowOpeningPlaceholder v-else-if="!error || creating || loading || opening" @cancel="requestClose" />
    <div v-else class="workflow-local-workspace__landing">
      <YjPageHeader :title="workflowId === 'new' ? '创建工作流' : '打开工作流'">
        <template #actions><button type="button" class="workflow-showcase-control yj-control" @click="requestClose">返回工作流</button></template>
      </YjPageHeader>
      <p v-if="error" class="workflow-local-workspace__notice" role="alert">{{ error.message }}</p>
      <YjEmpty title="暂时无法打开工作流"
        description="确认本地工作流服务已启动后重试。已创建的流程会保留，重试打开不会重复创建。" icon="workflow">
        <template #actions><button type="button" class="workflow-showcase-control yj-control" @click="start(workflowId)">重新连接</button></template>
      </YjEmpty>
    </div>

    <NModal :show="confirmClose" preset="dialog" title="确认离开？" :show-icon="false"
      style="width: min(var(--yj-layout-workflow-leave-width), calc(100vw - var(--yj-space-8)))"
      :mask-closable="false" :closable="false" @esc="decideClose(false)">
      <p class="workflow-local-workspace__leave-description">离开将丢失未保存的修改和本页节点配置。已提交的操作及运行记录不受影响。</p>
      <template #action>
        <button type="button" class="workflow-showcase-control yj-control" @click="decideClose(false)">继续编辑</button>
        <button type="button" class="workflow-showcase-control yj-control" @click="decideClose(true)">离开</button>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
.workflow-local-workspace { min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; }
.workflow-local-workspace__landing { padding: var(--yj-space-6); display: grid; align-content: start; gap: var(--yj-space-5); }
.workflow-local-workspace__notice { flex: none; margin: 0; padding: var(--yj-space-3); border-bottom: var(--yj-border-width) solid var(--yj-color-border-default); color: var(--yj-color-text-body); }
.workflow-local-workspace__leave-description { margin: 0; }
</style>
