<script setup lang="ts">
import { useId } from "vue";

defineProps<{
  title: string;
  description?: string;
}>();

const titleId = useId();
</script>

<template>
  <header class="yj-page-header" :aria-labelledby="titleId">
    <div class="yj-page-header__copy">
      <h1 :id="titleId" class="yj-page-header__title">{{ title }}</h1>
      <p v-if="description" class="yj-page-header__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="yj-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.yj-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--yj-space-6);
}

.yj-page-header__copy {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-2);
}

.yj-page-header__title,
.yj-page-header__description {
  margin: var(--yj-space-0);
}

.yj-page-header__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-page-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-page-title);
}

.yj-page-header__description {
  max-width: var(--yj-layout-form-max);
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.yj-page-header__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--yj-space-2);
}
</style>
