<script setup lang="ts" generic="Id extends string">
import { computed, ref, useId } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";

const props = defineProps<{
  label: string;
  unit: string;
  options: readonly { id: Id; name: string; value?: string; note: string; image?: string }[];
  selected: readonly Id[];
  single?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ choose: [id: Id] }>();
const group = useId();
const expanded = ref(false);
const visible = computed(() => expanded.value ? props.options : props.options.slice(0, 4));
</script>

<template>
  <fieldset class="workflow-choices" :disabled="disabled">
    <legend>{{ label }} <span>共 {{ options.length }} {{ unit }}</span></legend>
    <div :id="group + '-items'" class="choice-grid">
      <label v-for="option in visible" :key="option.id" class="choice" :class="{ 'choice--selected': selected.includes(option.id) }">
        <img v-if="option.image" :src="option.image" alt="" decoding="async" draggable="false" />
        <span class="choice__text"><strong>{{ option.name }}</strong><span><b v-if="option.value">{{ option.value }}</b>{{ option.note }}</span></span>
        <input :type="single ? 'radio' : 'checkbox'" :name="group" :value="option.id" :checked="selected.includes(option.id)"
          :aria-label="option.name" @change="emit('choose', option.id)" />
      </label>
    </div>
  </fieldset>
  <button v-if="options.length > 4" type="button" class="more-choices" :aria-expanded="expanded" :aria-controls="group + '-items'" @click="expanded = !expanded">
    {{ expanded ? '收起' : '展开剩余 ' + (options.length - 4) + ' ' + unit }}<YjIcon name="chevronDown" size="xs" />
  </button>
</template>

<style scoped>
.workflow-choices { min-width: 0; margin: 0; border: 0; padding: 0; }
.workflow-choices legend { margin-bottom: var(--yj-space-2); padding: 0; font-size: var(--yj-font-size-context-window); font-weight: var(--yj-font-weight-semibold); }
.workflow-choices legend span { margin-left: var(--yj-space-1); color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); font-weight: var(--yj-font-weight-regular); }
.choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--yj-space-2); }
.choice {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  min-width: 0;
  padding: var(--yj-space-2);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-card);
  cursor: pointer;
}
.choice:hover { border-color: var(--yj-color-border-strong); }
.choice--selected { border-color: var(--yj-color-border-control); }
.choice img { width: 44px; height: 44px; flex: none; border-radius: var(--yj-radius-sm); padding: 3px; background: var(--yj-color-bg-connector-artwork); object-fit: contain; }
.choice__text { display: grid; min-width: 0; gap: 2px; }
.choice__text strong { color: var(--yj-color-text-primary); font-size: var(--yj-font-size-context-window); line-height: var(--yj-line-height-context-window); font-weight: var(--yj-font-weight-medium); overflow-wrap: anywhere; }
.choice__text > span { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); }
.choice__text b { margin-right: var(--yj-space-1); color: var(--yj-color-text-primary); font-weight: var(--yj-font-weight-semibold); }
.choice input { width: 16px; height: 16px; margin: 0 0 0 auto; flex: none; accent-color: var(--yj-color-text-primary); }
.choice:has(input:focus-visible) { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
fieldset:disabled .choice { cursor: default; }
.more-choices { display: flex; align-items: center; gap: var(--yj-space-1); margin: var(--yj-space-1) auto 0; min-height: var(--yj-control-height-sm); padding: 0 var(--yj-space-2); color: var(--yj-color-text-secondary); background: transparent; border: 0; border-radius: var(--yj-radius-sm); font-size: var(--yj-font-size-caption); }
.more-choices:hover { background: var(--yj-color-control-hover); }
.more-choices[aria-expanded="true"] :deep(svg) { transform: rotate(180deg); }
@container scene-gallery (max-width: 550px) { .choice-grid { grid-template-columns: minmax(0, 1fr); } }
@media (pointer: coarse) { .choice, .more-choices { min-height: 44px; } }
</style>
