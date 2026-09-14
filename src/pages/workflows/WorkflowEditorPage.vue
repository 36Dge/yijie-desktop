<script setup lang="ts">
import { RouterLink } from "vue-router";
import WorkflowLocalWorkspace from "../../components/workflows/WorkflowLocalWorkspace.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjEmpty from "../../components/yijie/YjEmpty.vue";
import { workflowLocalUiEnabled } from "../../authorization/workflow-local-ui-config";
import "../../components/workflows/workflow-showcase.css";
defineProps<{ workflowId: string }>();
</script>

<template>
  <YjPage class="workflow-editor-page">
    <WorkflowLocalWorkspace v-if="workflowLocalUiEnabled" :workflow-id="workflowId" />
    <div v-else class="workflow-editor-page__unavailable">
      <YjPageHeader title="工作流编辑器" />
      <YjEmpty title="工作流服务尚未启用" description="启动本地工作流环境后，即可在这里创建和编辑流程。" icon="workflow">
        <template #actions><RouterLink to="/workflows" class="workflow-showcase-control yj-control">返回工作流</RouterLink></template>
      </YjEmpty>
    </div>
  </YjPage>
</template>

<style scoped>
.workflow-editor-page { height: 100%; min-height: 0; padding: 0; overflow: hidden; }
.workflow-editor-page__unavailable { padding: var(--yj-space-6); display: grid; gap: var(--yj-space-6); }
</style>
