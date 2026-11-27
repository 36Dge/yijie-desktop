<script setup lang="ts">
defineProps<{ label: string; disabled?: boolean }>();
const count = defineModel<number>({ required: true });
</script>
<template><div class="image-stepper">
  <button type="button" :disabled="disabled || count <= 1" :aria-label="'减少' + label" @click="count = Math.max(1, count - 1)">−</button>
  <strong>{{ count }}张</strong><button type="button" :disabled="disabled" :aria-label="'增加' + label" @click="count++">＋</button>
</div></template>
<style scoped>
.image-stepper { display: inline-flex; align-items: center; gap: 6px; }
.image-stepper button { width: 28px; height: 26px; padding: 0; }
.image-stepper strong { min-width: 25px; text-align: center; }
</style>
