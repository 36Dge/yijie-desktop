<template>
  <main class="page">
    <RouterLink to="/chat">返回 Chat</RouterLink>
    <h1>本地设置</h1>
    <section class="panel">
      <h2>Sidecar</h2>
      <p>桌面端会在后续版本管理 Codex Runtime 与 yijie-agent-host sidecar。</p>
    </section>
  </main>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 32px;
}

a {
  color: #1f6feb;
}

.panel {
  padding: 18px;
  border: 1px solid #d5e0e8;
  border-radius: 8px;
  background: #ffffff;
}
</style>
