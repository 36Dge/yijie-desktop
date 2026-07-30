<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { NButton, NCard, NH1, NInput, NSpace, NText } from "naive-ui";

const prompt = ref("请诊断这个 Amazon 商品链接的 Listing 优化空间");
const router = useRouter();

const canCreateTask = computed(() => prompt.value.trim().length > 0);
</script>

<template>
  <section class="chat-workspace">
    <header>
      <n-space align="center" justify="space-between">
        <n-h1>跨境电商 Agent 工作台</n-h1>
        <n-button secondary @click="router.push('/tasks')">任务列表</n-button>
      </n-space>
    </header>

    <n-card class="conversation" :bordered="false">
      <n-space vertical size="small">
        <n-text strong>易界 AI</n-text>
        <n-text>把商品链接、店铺问题或 SOP 任务发给我。MVP 阶段会优先打通 Listing 诊断闭环。</n-text>
      </n-space>
    </n-card>

    <n-card :bordered="false">
      <n-space vertical>
        <n-input
          v-model:value="prompt"
          type="textarea"
          :autosize="{ minRows: 4, maxRows: 8 }"
          aria-label="Chat prompt"
        />
        <n-space justify="end">
          <n-button type="primary" :disabled="!canCreateTask">创建本地任务</n-button>
        </n-space>
      </n-space>
    </n-card>
  </section>
</template>

<style scoped>
.chat-workspace {
  display: grid;
  min-height: 100%;
  grid-template-rows: auto 1fr auto;
  gap: var(--yj-space-5);
  padding: var(--yj-space-8);
  background: var(--yj-color-bg-page);
}

.conversation {
  align-self: start;
}
</style>
