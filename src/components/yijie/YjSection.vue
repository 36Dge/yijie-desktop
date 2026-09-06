<script setup lang="ts">
import { useId } from "vue";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "./YjIcon.vue";

defineProps<{
  title: string;
  description?: string;
  count?: number;
  icon?: YjIconName;
}>();

const titleId = useId();
</script>

<template>
  <section class="yj-section" :aria-labelledby="titleId">
    <header class="yj-section__header">
      <div class="yj-section__heading">
        <YjIcon v-if="icon" :name="icon" size="lg" tone="default" />
        <h2 :id="titleId" class="yj-section__title">{{ title }}</h2>
        <span v-if="count !== undefined" class="yj-section__count" :aria-label="`${count} 个 Skill`">
          {{ count }}
        </span>
      </div>
      <p v-if="description" class="yj-section__description">{{ description }}</p>
      <div v-if="$slots.actions" class="yj-section__actions">
        <slot name="actions" />
      </div>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.yj-section {
  display: grid;
  gap: var(--yj-space-4);
}

.yj-section__header {
  display: grid;
  gap: var(--yj-space-1);
}

.yj-section__heading {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
}

.yj-section__title,
.yj-section__description {
  margin: var(--yj-space-0);
}

.yj-section__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-section-title);
}

.yj-section__count {
  min-width: var(--yj-space-8);
  padding: var(--yj-space-1) var(--yj-space-2);
  border-radius: var(--yj-radius-full);
  color: var(--yj-color-text-tertiary);
  background: var(--yj-color-bg-subtle);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  text-align: center;
}

.yj-section__description {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.yj-section__actions {
  justify-self: end;
}
</style>
