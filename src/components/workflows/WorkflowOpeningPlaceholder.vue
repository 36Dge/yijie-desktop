<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

withDefaults(defineProps<{ canCancel?: boolean }>(), { canCancel: true });
const emit = defineEmits<{ cancel: [] }>();
const showHint = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
onMounted(() => {
  // Delay feedback, never the request or the canvas itself.
  timer = setTimeout(() => { showHint.value = true; }, 180);
});
onBeforeUnmount(() => { clearTimeout(timer); });
</script>

<template>
  <div class="workflow-opening-placeholder" role="status" aria-label="正在打开工作流" aria-busy="true">
    <div v-if="showHint" class="workflow-opening-placeholder__hint">
      <p>正在打开工作流…</p>
      <button v-if="canCancel" type="button" class="workflow-showcase-control yj-control" @click="emit('cancel')">返回工作流</button>
    </div>
  </div>
</template>

<style scoped>
.workflow-opening-placeholder { flex: 1; width: 100%; height: 100%; min-height: 0; display: grid; place-content: center; background: var(--yj-color-bg-subtle); color: var(--yj-color-text-secondary); }
.workflow-opening-placeholder__hint { display: grid; justify-items: center; gap: var(--yj-space-3); }
.workflow-opening-placeholder__hint p { margin: 0; }
</style>
