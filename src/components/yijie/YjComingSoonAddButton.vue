<script setup lang="ts">
import { NButton } from "naive-ui";
import YjIcon from "./YjIcon.vue";
import YjTooltip from "./YjTooltip.vue";

defineProps<{ label: string }>();
</script>

<template>
  <YjTooltip text="即将支持" placement="bottom-end">
    <span class="yj-coming-soon-add" role="group" tabindex="0" :aria-label="label" aria-disabled="true">
      <NButton type="primary" :bordered="false" disabled>
        <template #icon><YjIcon name="plus" size="sm" /></template>
        {{ label }}
      </NButton>
    </span>
  </YjTooltip>
</template>

<style scoped>
.yj-coming-soon-add { display: inline-flex; border-radius: var(--yj-radius-md); cursor: not-allowed; }
.yj-coming-soon-add > :disabled { pointer-events: none; }
.yj-coming-soon-add:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-focus-ring-width);
}
</style>
