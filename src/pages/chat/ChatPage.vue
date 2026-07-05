<script setup lang="ts">
import { computed, h, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import {
  NButton,
  NCard,
  NH1,
  NInput,
  NLayout,
  NLayoutContent,
  NLayoutSider,
  NMenu,
  NSpace,
  NTag,
  NText,
} from "naive-ui";
import { useAppStore } from "../../stores/app";

const prompt = ref("请诊断这个 Amazon 商品链接的 Listing 优化空间");
const appStore = useAppStore();
const router = useRouter();
const { productName, runtimeMode } = storeToRefs(appStore);

const canCreateTask = computed(() => prompt.value.trim().length > 0);
const menuOptions = [
  { label: () => h(RouterLink, { to: "/chat" }, { default: () => "Chat" }), key: "chat" },
  { label: () => h(RouterLink, { to: "/tasks" }, { default: () => "Tasks" }), key: "tasks" },
  { label: () => h(RouterLink, { to: "/settings" }, { default: () => "Settings" }), key: "settings" },
];
</script>

<template>
  <n-layout has-sider class="desktop-shell">
    <n-layout-sider class="sidebar" :width="220" bordered>
      <strong>{{ productName }}</strong>
      <n-menu :options="menuOptions" default-value="chat" />
    </n-layout-sider>

    <n-layout-content class="chat-workspace">
      <header>
        <n-space align="center" justify="space-between">
          <div>
            <n-tag size="small" type="success">{{ runtimeMode }}</n-tag>
            <n-h1>跨境电商 Agent 工作台</n-h1>
          </div>
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
    </n-layout-content>
  </n-layout>
</template>

<style scoped>
.desktop-shell {
  min-height: 100vh;
}

.sidebar {
  padding: 24px 12px;
  background: #12343b;
}

.sidebar strong {
  display: block;
  margin: 0 12px 18px;
  color: #ffffff;
  font-size: 20px;
}

.sidebar :deep(.n-menu-item-content) {
  color: #d7eef2;
}

.sidebar :deep(.n-menu-item-content--selected),
.sidebar :deep(.n-menu-item-content:hover) {
  color: #ffffff;
}

.chat-workspace {
  display: grid;
  min-height: 100vh;
  grid-template-rows: auto 1fr auto;
  gap: 20px;
  padding: 32px;
  background: #eef3f8;
}

.conversation {
  align-self: start;
}

@media (max-width: 760px) {
  .desktop-shell {
    display: block;
  }
}
</style>
