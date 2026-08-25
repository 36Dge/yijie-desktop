<script setup lang="ts">
withDefaults(defineProps<{
  width?: "full" | "detail" | "form";
}>(), {
  width: "full",
});
</script>

<template>
  <div class="yj-page" :class="`yj-page--${width}`">
    <slot />
  </div>
</template>

<style scoped>
.yj-page {
  width: 100%;
  min-height: 100%;
  padding: var(--yj-space-6);
  margin-inline: auto;
  background: var(--yj-color-bg-page);
}

.yj-page--detail {
  max-width: var(--yj-layout-form-max);
}

.yj-page--form {
  max-width: var(--yj-layout-form-max);
}
</style>
