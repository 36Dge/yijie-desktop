<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import { NModal } from "naive-ui";
import { useWorkflowWorkspace } from "../../pages/workflows/use-workflow-workspace";
import { useWorkflowRuns } from "../../pages/workflows/use-workflow-runs";
import type { WorkflowSchemas } from "../../api/workflow-native-client";
import WorkflowEditorPane from "./WorkflowEditorPane.vue";
import WorkflowRunPanel from "./WorkflowRunPanel.vue";
import YjEmpty from "../yijie/YjEmpty.vue";
import YjIcon from "../yijie/YjIcon.vue";
import YjSection from "../yijie/YjSection.vue";

const state = useWorkflowWorkspace();
const { workflows, status, error, loading, creating, opening, openPending, reconnecting, closing,
  editor, dirty, pendingWrites, pendingCreate, createUncertain, nextCursor } = state;
const emit = defineEmits<{ editing: [value: boolean] }>();
const runs = useWorkflowRuns(editor);
const { submitting: running, pending: uncertainRun } = runs;
watch(() => !!editor.value, value => emit("editing", value));

function acceptResult(result: WorkflowSchemas["EditorExchangeResult"]) {
  state.acceptEditorResult(result);
  if (result.run) runs.accept(result.run);
}
const createForm = ref(false);
const name = ref("");
const confirmClose = ref(false);
const leaveMessage = ref("");
let finishLeave: ((allowed: boolean) => void) | undefined;

onMounted(() => { void state.refresh(); });

async function submitCreate() {
  if (await state.create(name.value)) {
    createForm.value = false;
    name.value = "";
  }
}

function askToClose(): Promise<boolean> {
  if (createUncertain.value) {
    leaveMessage.value = "操作结果尚未确认，请先查询原操作，避免丢失查询入口。";
    return Promise.resolve(false);
  }
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

async function requestClose() {
  if (await askToClose()) await state.closeEditor();
}

onBeforeRouteLeave(async () => {
  if (!(await askToClose())) return false;
  if (openPending.value) await state.cancelOpening();
  if (editor.value) {
    await state.closeEditor();
    if (editor.value) return false;
  }
  return true;
});

function modifiedAt(time: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(time));
}
</script>

<template>
  <div class="workflow-local-workspace">
    <p v-if="leaveMessage" class="workflow-local-workspace__notice" role="status">{{ leaveMessage }}</p>
    <p v-if="error && !editor" class="workflow-local-workspace__notice" role="alert">{{ error.message }}</p>

    <WorkflowEditorPane v-if="editor" :key="editor.workflow.workflow_id" :view="editor"
      :reconnecting="reconnecting" :closing="closing" :dirty="dirty" :pending-writes="pendingWrites" :parent-failure="error"
      @close="requestClose" @reconnect="state.openWorkflow(editor.workflow.workflow_id, true)"
      @dirty="dirty = $event" @busy="pendingWrites = $event"
      @result="acceptResult" @failure="state.acceptEditorFailure" />

    <WorkflowRunPanel v-if="editor" :state="runs" :latest-version="editor.workflow.published_version"
      :busy="pendingWrites > 0 || reconnecting || closing" />

    <YjSection v-else title="我的工作流" icon="workflow">
      <template #actions>
        <button type="button" class="workflow-showcase-control yj-control" :disabled="loading || openPending"
          @click="state.refresh()">刷新</button>
        <button type="button" class="workflow-showcase-control yj-control workflow-local-workspace__create"
          :disabled="!status?.ready || creating || openPending || createUncertain" @click="createForm = true">
          <YjIcon name="plus" size="sm" />创建工作流
        </button>
      </template>

      <form v-if="createForm" class="workflow-local-workspace__create-form" @submit.prevent="submitCreate">
        <label for="workflow-name">工作流名称</label>
        <input id="workflow-name" v-model="name" class="yj-control" maxlength="80" required
          placeholder="例如：文本整理流程" autocomplete="off" :disabled="creating || createUncertain" />
        <div class="workflow-local-workspace__form-actions">
          <button type="submit" class="workflow-showcase-control yj-control workflow-local-workspace__primary"
            :disabled="creating || !name.trim() || createUncertain" :aria-busy="creating">{{ creating ? '正在创建…' : '创建并打开' }}</button>
          <button type="button" class="workflow-showcase-control yj-control" :disabled="creating || createUncertain"
            @click="createForm = false">取消</button>
        </div>
        <p v-if="pendingCreate" role="status">创建结果待确认，请查询原操作后继续。</p>
        <p v-else-if="createUncertain" role="status">创建结果待确认，尚未取得可查询的操作标识。请保留当前页面并核对工作流列表。</p>
        <button v-if="pendingCreate" type="button" class="workflow-showcase-control yj-control" :disabled="creating"
          @click="state.queryPendingCreate()">查询创建结果</button>
      </form>

      <div v-if="opening" class="workflow-local-workspace__notice" role="status">
        正在读取工作流并建立编辑会话…
        <button type="button" class="workflow-showcase-control yj-control" @click="state.cancelOpening()">取消打开</button>
      </div>
      <p v-else-if="openPending" class="workflow-local-workspace__notice" role="status">正在完成取消并撤销编辑会话…</p>
      <p v-if="loading" class="workflow-local-workspace__notice" role="status">正在读取工作流…</p>
      <YjEmpty v-else-if="!status?.ready" title="工作流服务尚未就绪" description="完成本地工作流启动后，重试连接即可继续；其他页面仍可使用。" icon="workflow">
        <template #actions><button type="button" class="workflow-showcase-control yj-control" @click="state.refresh()">重试连接</button></template>
      </YjEmpty>
      <YjEmpty v-else-if="workflows.length === 0" title="还没有工作流" description="创建通用文本流程，从开始、文本拼接和结束节点搭建第一条工作流。" icon="workflow" />
      <ul v-else class="workflow-local-workspace__grid" aria-label="真实工作流列表">
        <li v-for="workflow in workflows" :key="workflow.workflow_id">
          <article class="workflow-local-workspace__card workflow-showcase-card">
            <div class="workflow-local-workspace__card-header">
              <YjIcon name="workflow" size="xl" />
              <span class="yj-badge">{{ workflow.published_version ? '有内部版本' : '草稿' }}</span>
            </div>
            <h3>{{ workflow.name }}</h3>
            <p>{{ workflow.runnable ? '通用文本流程' : '继续完善节点和连线' }}</p>
            <span class="workflow-local-workspace__meta">修改于 {{ modifiedAt(workflow.updated_at_ms) }}</span>
            <button type="button" class="workflow-showcase-control yj-control" :disabled="openPending || creating"
              :aria-label="`编辑 ${workflow.name}`" @click="state.openWorkflow(workflow.workflow_id)">打开编辑器</button>
          </article>
        </li>
      </ul>
      <button v-if="nextCursor" type="button" class="workflow-showcase-control yj-control" :disabled="loading"
        @click="state.refresh(true)">加载更多</button>
    </YjSection>

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
.workflow-local-workspace { min-width: 0; display: grid; gap: var(--yj-space-6); }
.workflow-local-workspace__notice { display: flex; align-items: center; flex-wrap: wrap; gap: var(--yj-space-3); margin: 0 0 var(--yj-space-3); padding: var(--yj-space-3); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); color: var(--yj-color-text-body); }
.workflow-local-workspace__create { border-style: dashed; }
.workflow-local-workspace__create-form { display: grid; gap: var(--yj-space-3); max-width: var(--yj-layout-form-max); margin-bottom: var(--yj-space-4); padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); }
.workflow-local-workspace__create-form input { width: 100%; color: var(--yj-color-text-body); background: var(--yj-color-bg-card); }
.workflow-local-workspace__form-actions { display: flex; gap: var(--yj-space-2); }
.workflow-local-workspace__primary { color: var(--yj-color-on-brand); background: var(--yj-color-brand-primary); }
.workflow-local-workspace__primary:hover { background: var(--yj-color-brand-hover); }
.workflow-local-workspace__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-4); padding: 0; margin: 0; list-style: none; }
.workflow-local-workspace__grid > li { min-width: 0; }
.workflow-local-workspace__card { display: flex; flex-direction: column; gap: var(--yj-space-3); height: 100%; min-height: calc(var(--yj-space-16) * 3 + var(--yj-space-8)); padding: var(--yj-space-5); border: var(--yj-border-width) solid var(--yj-color-border-subtle); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); }
.workflow-local-workspace__card-header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-3); }
.workflow-local-workspace__card h3 { margin: 0; font-size: var(--yj-font-size-card-title); line-height: var(--yj-line-height-card-title); overflow-wrap: anywhere; }
.workflow-local-workspace__card p { margin: 0; color: var(--yj-color-text-body); }
.workflow-local-workspace__meta { margin-top: auto; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.workflow-local-workspace__card .yj-badge { color: var(--yj-color-text-secondary); background: var(--yj-color-control-hover); }
@container workflow-page (min-width: 1120px) { .workflow-local-workspace__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@container workflow-page (max-width: 600px) { .workflow-local-workspace__grid { grid-template-columns: minmax(0, 1fr); } }
</style>
