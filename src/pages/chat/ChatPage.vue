<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useAppStore } from "../../stores/app";

const prompt = ref("请诊断这个 Amazon 商品链接的 Listing 优化空间");
const appStore = useAppStore();
const { productName, runtimeMode } = storeToRefs(appStore);

const canCreateTask = computed(() => prompt.value.trim().length > 0);
</script>

<template>
  <main class="desktop-shell">
    <aside class="sidebar">
      <strong>{{ productName }}</strong>
      <RouterLink to="/chat">Chat</RouterLink>
      <RouterLink to="/tasks">Tasks</RouterLink>
      <RouterLink to="/settings">Settings</RouterLink>
    </aside>

    <section class="chat-workspace">
      <header>
        <p class="eyebrow">{{ runtimeMode }}</p>
        <h1>跨境电商 Agent 工作台</h1>
      </header>

      <section class="conversation">
        <article class="message assistant">
          <strong>易界 AI</strong>
          <p>把商品链接、店铺问题或 SOP 任务发给我。MVP 阶段会优先打通 Listing 诊断闭环。</p>
        </article>
      </section>

      <form class="composer" @submit.prevent>
        <textarea v-model="prompt" rows="4" aria-label="Chat prompt" />
        <button :disabled="!canCreateTask" type="submit">创建本地任务</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.desktop-shell {
  display: grid;
  min-height: 100vh;
  grid-template-columns: 220px 1fr;
}

.sidebar {
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 24px;
  color: #ffffff;
  background: #12343b;
}

.sidebar strong {
  margin-bottom: 18px;
  font-size: 20px;
}

.sidebar a {
  color: #d7eef2;
  text-decoration: none;
}

.chat-workspace {
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 20px;
  padding: 32px;
}

h1,
p {
  margin-top: 0;
}

.eyebrow {
  color: #287271;
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.conversation,
.composer,
.message {
  border: 1px solid #d5e0e8;
  border-radius: 8px;
  background: #ffffff;
}

.conversation {
  padding: 20px;
}

.message {
  padding: 16px;
}

.composer {
  display: grid;
  gap: 12px;
  padding: 16px;
}

textarea {
  min-height: 110px;
  resize: vertical;
  border: 1px solid #c8d7df;
  border-radius: 6px;
  padding: 12px;
}

button {
  justify-self: end;
  color: #ffffff;
  background: #1f6feb;
  border: 0;
  border-radius: 6px;
  padding: 10px 14px;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

@media (max-width: 760px) {
  .desktop-shell {
    grid-template-columns: 1fr;
  }
}
</style>
