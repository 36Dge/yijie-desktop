<script setup lang="ts">
import { computed } from "vue";
import type { useWorkflowRuns } from "../../pages/workflows/use-workflow-runs";
import { workflowFailure } from "../../api/workflow-native-client";
import YjSection from "../yijie/YjSection.vue";
const props = defineProps<{
  state: ReturnType<typeof useWorkflowRuns>;
  latestVersion?: string;
  busy: boolean;
}>();
const { history, selected, error, pending, activeRun, loading, reading, submitting, version, input, nextCursor } = props.state;
const inputBytes = computed(() => new TextEncoder().encode(input.value).length);
const validInput = computed(() => inputBytes.value <= 4096 && /^v0\.0\.[1-9][0-9]{0,8}$/.test(version.value.trim()));
const stateName = (state: string) => ({ running: "运行中", succeeded: "成功", failed: "失败", cancelled: "已取消", interrupted: "已中断", unknown: "结果未确定" })[state] ?? `未识别状态（${state}）`;
const at = (time: number) => new Date(time).toLocaleString("zh-CN", { hour12: false });
</script>

<template>
  <YjSection title="运行与历史" icon="workflow">
    <template #actions>
      <button class="workflow-showcase-control yj-control" :disabled="loading" @click="state.refresh()">{{ loading ? '正在读取…' : '刷新历史' }}</button>
    </template>
    <div class="workflow-runs">
      <form class="workflow-runs__form" @submit.prevent="state.start()">
        <h3>执行内部版本</h3>
        <p v-if="latestVersion">最新内部版本为 {{ latestVersion }}。选择要执行的版本；未保存的草稿不会影响已发布版本。</p>
        <p v-else>保存并成功试运行草稿后，在画布中内部发布，即可执行版本。</p>
        <label for="workflow-run-version">版本</label>
        <input id="workflow-run-version" v-model="version" class="yj-control" placeholder="例如 v0.0.1" :disabled="submitting || !!pending" autocomplete="off" />
        <label for="workflow-run-input">运行输入</label>
        <textarea id="workflow-run-input" v-model="input" class="yj-control" rows="3" :disabled="submitting || !!pending" placeholder="输入需要处理的文本" />
        <span :role="inputBytes > 4096 ? 'alert' : undefined">{{ inputBytes }} / 4096 字节</span>
        <button type="submit" class="workflow-showcase-control yj-control workflow-runs__primary"
          :disabled="!latestVersion || !validInput || busy || submitting || !!pending || !!activeRun" :aria-busy="submitting">{{ submitting ? '正在确认执行…' : '执行所选版本' }}</button>
        <p v-if="activeRun" role="status">运行 {{ activeRun.run_id }} 尚未取得终态，请更新该运行结果后继续。</p>
        <button v-if="activeRun" type="button" class="workflow-showcase-control yj-control" :disabled="reading" @click="state.read(activeRun.run_id)">核对进行中的运行</button>
        <p v-if="pending" role="status">执行结果待确认。已保留原操作，不会重复发起。
          <span v-if="!pending.operationId">尚未取得可查询的操作标识，请保留此页并刷新历史核对。</span>
        </p>
        <button v-if="pending?.operationId" type="button" class="workflow-showcase-control yj-control" :disabled="submitting" @click="state.reconcile()">查询原执行结果</button>
      </form>

      <section class="workflow-runs__result" aria-label="工作流运行结果" :aria-busy="reading">
        <div class="workflow-runs__heading"><h3>运行结果</h3>
          <button v-if="selected" class="workflow-showcase-control yj-control" :disabled="reading" @click="state.read(selected.run_id)">更新结果</button>
        </div>
        <p v-if="reading" role="status">正在读取所选运行…</p>
        <template v-if="selected">
          <p role="status">{{ selected.mode === 'debug' ? '草稿试运行' : `版本 ${selected.version}` }} · {{ stateName(selected.state) }}{{ !selected.terminal ? ' · 尚未取得终态' : '' }}</p>
          <dl class="workflow-runs__facts">
            <dt>运行编号</dt><dd>{{ selected.run_id }}</dd>
            <dt>开始时间</dt><dd>{{ at(selected.started_at_ms) }}</dd>
            <template v-if="selected.finished_at_ms !== undefined"><dt>结束时间</dt><dd>{{ at(selected.finished_at_ms) }}</dd></template>
            <template v-if="selected.revision"><dt>草稿版本</dt><dd>{{ selected.revision }}</dd></template>
          </dl>
          <h4>输入</h4><pre>{{ selected.input?.input ?? '服务端未提供输入' }}</pre>
          <h4>输出</h4><pre>{{ selected.output === undefined ? '尚无输出' : selected.output === '' ? '（空文本）' : selected.output }}</pre>
          <p v-if="selected.error" role="alert">{{ workflowFailure(selected.error).message }}</p>
          <details v-if="selected.nodes?.length"><summary>节点结果（{{ selected.nodes.length }}）</summary>
            <ul class="workflow-runs__nodes"><li v-for="node in selected.nodes" :key="node.node_id">
              <strong>节点 {{ node.node_id }}</strong><span>原生状态 {{ node.state }}</span>
              <pre v-if="node.output !== undefined">{{ node.output === '' ? '（空文本）' : node.output }}</pre>
              <p v-if="node.error">{{ workflowFailure(node.error).message }}</p>
            </li></ul>
          </details>
        </template>
        <p v-else>试运行、执行版本或选择一条历史，查看服务端返回的真实结果。</p>
      </section>

      <p v-if="error" class="workflow-runs__notice" role="alert">{{ error.message }} 可刷新历史或更新所选结果后继续。</p>
      <section class="workflow-runs__history" aria-label="工作流运行历史">
        <h3>运行历史</h3>
        <p v-if="!history.length && !loading">暂无运行记录。</p>
        <ul v-else class="workflow-runs__history-list">
          <li v-for="run in history" :key="run.run_id">
            <button class="workflow-runs__history-row yj-control" :aria-pressed="selected?.run_id === run.run_id" @click="state.read(run.run_id)">
              <span>{{ run.mode === 'debug' ? '草稿试运行' : `内部版本 ${run.version}` }}</span>
              <span>{{ stateName(run.state) }}{{ !run.terminal ? ' · 未终结' : '' }}</span>
              <time>{{ at(run.started_at_ms) }}</time>
              <span class="workflow-runs__id">{{ run.run_id }}</span>
            </button>
          </li>
        </ul>
        <button v-if="nextCursor" class="workflow-showcase-control yj-control" :disabled="loading" @click="state.refresh(true)">加载更多运行</button>
      </section>
    </div>
  </YjSection>
</template>

<style scoped>
.workflow-runs { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: var(--yj-space-5); min-width: 0; }
.workflow-runs__form, .workflow-runs__result { display: flex; flex-direction: column; align-items: stretch; gap: var(--yj-space-3); padding: var(--yj-space-4); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-lg); min-width: 0; background: var(--yj-color-bg-card); }
.workflow-runs h3, .workflow-runs h4, .workflow-runs p, .workflow-runs dl { margin: 0; }
.workflow-runs h3 { font-size: var(--yj-font-size-card-title); }
.workflow-runs p, .workflow-runs__form > span, .workflow-runs time { color: var(--yj-color-text-secondary); }
.workflow-runs p { line-height: var(--yj-line-height-body); }
.workflow-runs input, .workflow-runs textarea { width: 100%; background: var(--yj-color-bg-card); color: var(--yj-color-text-body); }
.workflow-runs textarea { resize: vertical; min-height: var(--yj-space-16); }
.workflow-runs__primary { background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); }
.workflow-runs__primary:hover { background: var(--yj-color-brand-hover); }
.workflow-runs__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--yj-space-2); }
.workflow-runs__facts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--yj-space-2) var(--yj-space-3); font-size: var(--yj-font-size-caption); }
.workflow-runs__facts dt { color: var(--yj-color-text-secondary); }
.workflow-runs__facts dd { margin: 0; overflow-wrap: anywhere; }
.workflow-runs pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: var(--yj-font-size-body); font-family: inherit; margin: 0; max-height: calc(var(--yj-space-16) * 4); overflow: auto; padding: var(--yj-space-3); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-page); border: var(--yj-border-width) solid var(--yj-color-border-subtle); }
.workflow-runs__history, .workflow-runs__notice { grid-column: 1 / -1; }
.workflow-runs__history-list, .workflow-runs__nodes { padding: 0; list-style: none; display: grid; gap: var(--yj-space-2); }
.workflow-runs__history-row { width: 100%; display: flex; align-items: center; flex-wrap: wrap; text-align: left; gap: var(--yj-space-3); padding: var(--yj-space-3); border: var(--yj-border-width) solid var(--yj-color-border-default); border-radius: var(--yj-radius-md); background: var(--yj-color-bg-card); color: var(--yj-color-text-body); }
.workflow-runs__history-row[aria-pressed="true"], .workflow-runs__history-row:hover { background: var(--yj-color-control-hover); }
.workflow-runs__id { margin-left: auto; overflow-wrap: anywhere; font-size: var(--yj-font-size-caption); }
.workflow-runs__nodes li { display: grid; gap: var(--yj-space-2); }
.workflow-runs summary { cursor: pointer; padding: var(--yj-space-2) 0; }
.workflow-runs summary:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: var(--yj-space-1); }
@container workflow-page (max-width: 780px) { .workflow-runs { grid-template-columns: minmax(0, 1fr); } }
</style>
