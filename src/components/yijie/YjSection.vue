<script setup lang="ts">
import { useId } from "vue";
import type { YjIconName } from "../../icons/registry";
import YjIcon from "./YjIcon.vue";

defineProps<{
  title: string;
  description?: string;
  count?: number;
  icon?: YjIconName;
  actionsPlacement?: "inline" | "below";
}>();

const titleId = useId();
</script>

<template>
  <section class="yj-section" :class="{ 'yj-section--actions-below': actionsPlacement === 'below' }" :aria-labelledby="titleId">
    <header class="yj-section__header">
      <div class="yj-section__heading">
        <YjIcon v-if="icon" :name="icon" size="lg" tone="default" />
        <h2 :id="titleId" class="yj-section__title">{{ title }}</h2>
        <span v-if="count !== undefined" class="yj-section__count yj-badge yj-badge--count" :aria-label="`${count} 个 Skill`">
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
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--yj-space-1) var(--yj-space-4);
}

.yj-section__heading {
  grid-column: 1;
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
}

.yj-section__title,
.yj-section__description {
  grid-column: 1;
  margin: var(--yj-space-0);
}

.yj-section__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-section-title);
}

.yj-section__count {
  color: var(--yj-color-text-tertiary);
  background: var(--yj-color-bg-subtle);
  text-align: center;
}

.yj-section__description {
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.yj-section__actions {
  min-width: 0;
  grid-column: 2;
  grid-row: 1 / span 2;
  justify-self: end;
}

.yj-section--actions-below .yj-section__actions {
  grid-column: 1 / -1;
  grid-row: 3;
  justify-self: start;
  padding-top: var(--yj-space-3);
}
</style>
