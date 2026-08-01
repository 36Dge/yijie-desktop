<template>
  <section class="access-denied" aria-labelledby="access-denied-title">
    <div class="access-denied__panel" role="alert">
      <p class="access-denied__eyebrow">访问受限</p>
      <h1 id="access-denied-title">无权访问此模块</h1>
      <p>当前租户没有该模块的使用权限。页面内容未加载，也不会尝试绕过权限。</p>
      <RouterLink class="access-denied__action" to="/settings">前往设置</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.access-denied {
  display: grid;
  min-height: 100%;
  padding: var(--yj-space-8);
  place-items: center;
  background: var(--yj-color-bg-page);
}

.access-denied__panel {
  width: min(100%, var(--yj-layout-form-max));
  padding: var(--yj-space-8);
  border: 1px solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
}

.access-denied__eyebrow {
  margin: 0 0 var(--yj-space-2);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
}

.access-denied h1 {
  margin: 0 0 var(--yj-space-3);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-page-title);
}

.access-denied p {
  color: var(--yj-color-text-secondary);
}

.access-denied__action {
  display: inline-flex;
  margin-top: var(--yj-space-4);
  color: var(--yj-color-brand-text);
  font-weight: var(--yj-font-weight-semibold);
}
</style>
