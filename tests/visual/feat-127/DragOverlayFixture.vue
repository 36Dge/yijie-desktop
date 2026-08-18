<script setup lang="ts">
import ChatComposer from "../../../src/components/chat/ChatComposer.vue";

const readiness = Object.freeze({
  title: "本地运行环境已就绪",
  detail: "只读",
  actionLabel: null,
  tone: "success" as const,
});
</script>

<template>
  <section class="drag-fixture" aria-label="拖拽上传视觉状态">
    <h1 class="sr-only">拖拽上传视觉状态</h1>
    <div class="drag-fixture__conversation" aria-hidden="true" />
    <footer class="drag-fixture__footer">
      <ChatComposer
        model-value=""
        mode="reply"
        :projects="[]"
        :selected-project-id="null"
        active-project-name="Local Design Workspace"
        :readiness="readiness"
        :can-send="true"
        :can-attach="true"
        :sending="false"
        :streaming="false"
        :recovery-available="false"
        :drag-active="true"
      />
    </footer>
  </section>
</template>

<style scoped>
.drag-fixture {
  display: grid;
  min-height: 100%;
  grid-template-rows: minmax(0, 1fr) auto;
  background: var(--yj-color-bg-page);
}

.drag-fixture__conversation {
  min-height: 240px;
}

.drag-fixture__footer {
  display: flex;
  justify-content: center;
  padding: var(--yj-space-4) var(--yj-space-6) var(--yj-space-6);
  border-top: var(--yj-border-width) solid var(--yj-color-border-subtle);
  background: var(--yj-color-bg-page);
}
</style>
