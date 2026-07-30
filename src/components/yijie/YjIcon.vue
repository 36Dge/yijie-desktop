<script setup lang="ts">
import { computed } from "vue";
import { iconRegistry, type YjIconName } from "../../icons/registry";

const sizeMap = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 24,
} as const;

const props = withDefaults(
  defineProps<{
    name: YjIconName;
    size?: keyof typeof sizeMap;
    tone?: "default" | "muted" | "primary" | "success" | "warning" | "error";
    strokeWidth?: number;
    label?: string;
  }>(),
  {
    size: "md",
    tone: "default",
    strokeWidth: 2,
  },
);

const iconComponent = computed(() => iconRegistry[props.name]);
const toneClass = computed(() => `yj-icon--${props.tone}`);
</script>

<template>
  <component
    :is="iconComponent"
    class="yj-icon"
    :class="toneClass"
    :size="sizeMap[props.size]"
    :stroke-width="props.strokeWidth"
    :aria-hidden="props.label ? undefined : 'true'"
    :aria-label="props.label"
    :role="props.label ? 'img' : undefined"
    focusable="false"
  />
</template>

<style scoped>
.yj-icon {
  display: inline-flex;
  flex-shrink: 0;
  vertical-align: middle;
}

.yj-icon--default {
  color: var(--yj-color-icon-default);
}

.yj-icon--muted {
  color: var(--yj-color-icon-muted);
}

.yj-icon--primary {
  color: var(--yj-color-brand-primary);
}

.yj-icon--success {
  color: var(--yj-color-success);
}

.yj-icon--warning {
  color: var(--yj-color-warning);
}

.yj-icon--error {
  color: var(--yj-color-error);
}
</style>
