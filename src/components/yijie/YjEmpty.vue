<script setup lang="ts">
import type { YjIconName } from "../../icons/registry";
import YjIcon from "./YjIcon.vue";

withDefaults(defineProps<{
  title: string;
  description: string;
  icon?: YjIconName;
  role?: "status" | "alert";
}>(), {
  icon: "plugin",
  role: "status",
});
</script>

<template>
  <div class="yj-empty" :role="role">
    <span class="yj-empty__icon" aria-hidden="true">
      <YjIcon :name="icon" size="xl" tone="muted" />
    </span>
    <div class="yj-empty__copy">
      <h2 class="yj-empty__title">{{ title }}</h2>
      <p class="yj-empty__description">{{ description }}</p>
    </div>
    <div v-if="$slots.actions" class="yj-empty__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.yj-empty {
  display: grid;
  min-height: calc(var(--yj-space-16) * 3);
  place-content: center;
  justify-items: center;
  padding: var(--yj-space-8);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
  text-align: center;
}

.yj-empty__icon {
  display: inline-flex;
  width: var(--yj-space-12);
  height: var(--yj-space-12);
  align-items: center;
  justify-content: center;
  border-radius: var(--yj-radius-full);
  background: var(--yj-color-bg-subtle);
}

.yj-empty__copy {
  display: grid;
  max-width: var(--yj-layout-form-max);
  margin-top: var(--yj-space-4);
  gap: var(--yj-space-1);
}

.yj-empty__title,
.yj-empty__description {
  margin: var(--yj-space-0);
}

.yj-empty__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-section-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-section-title);
}

.yj-empty__description {
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

.yj-empty__actions {
  margin-top: var(--yj-space-4);
}
</style>
