<script setup lang="ts">
import { computed } from "vue";
import logoMarkUrl from "../../assets/brand/yijie-bag-logo.svg";

const props = withDefaults(
  defineProps<{
    variant?: "mark" | "horizontal" | "icon-only";
    size?: "sm" | "md" | "lg";
  }>(),
  {
    variant: "horizontal",
    size: "md",
  },
);

const showText = computed(() => props.variant === "horizontal");
</script>

<template>
  <span
    class="yj-logo"
    :class="[`yj-logo--${props.variant}`, `yj-logo--${props.size}`]"
    aria-label="易界"
    role="img"
  >
    <img class="yj-logo__mark" :src="logoMarkUrl" alt="" />
    <span v-if="showText" class="yj-logo__text" aria-hidden="true">易界</span>
  </span>
</template>

<style scoped>
.yj-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--yj-space-2);
  color: var(--yj-color-text-primary);
  font-family: var(--yj-font-family-sans);
  font-weight: 700;
}

.yj-logo__mark {
  display: block;
  width: var(--yj-logo-mark-size);
  height: var(--yj-logo-mark-size);
}

.yj-logo--sm {
  --yj-logo-mark-size: var(--yj-logo-mark-sm);
  font-size: var(--yj-font-size-card-title);
  line-height: var(--yj-line-height-card-title);
}

.yj-logo--md {
  --yj-logo-mark-size: var(--yj-logo-mark-md);
  font-size: var(--yj-font-size-section-title);
  line-height: var(--yj-line-height-section-title);
}

.yj-logo--lg {
  --yj-logo-mark-size: var(--yj-logo-mark-lg);
  font-size: var(--yj-font-size-metric-md);
  line-height: var(--yj-line-height-page-title);
}
</style>
