<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { NDropdown } from "naive-ui";
import YjIcon from "../../../components/yijie/YjIcon.vue";
import YjTooltip from "../../../components/yijie/YjTooltip.vue";
import type { YjIconName } from "../../../icons/registry";

const props = defineProps<{ label: string; icon: YjIconName; options: readonly string[]; iconOnly?: boolean }>();
const emit = defineEmits<{ select: [] }>();
const open = ref(false);
const menuId = useId();
const items = computed(() => props.options.map(label => ({ key: label, label, props: { role: "menuitem" } })));

function openByArrow(event: KeyboardEvent) {
  if (open.value) return;
  event.preventDefault();
  open.value = true;
}
</script>

<template>
  <NDropdown v-model:show="open" trigger="click" placement="bottom-start" :options="items"
    :menu-props="() => ({ id: menuId, role: 'menu', 'aria-label': label })"
    @select="emit('select')">
    <span class="preview-menu-anchor">
      <YjTooltip :text="iconOnly ? label : null">
        <button type="button" class="preview-menu yj-control yj-control--pill" :class="{ 'yj-control--icon': iconOnly }"
          :aria-label="label" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
          @keydown.down="openByArrow">
          <YjIcon :name="icon" size="sm" :stroke-width="1.5" />
          <template v-if="!iconOnly"><span>{{ label }}</span><YjIcon name="chevronDown" class="yj-control__chevron" size="xs" /></template>
        </button>
      </YjTooltip>
    </span>
  </NDropdown>
</template>

<style scoped>
.preview-menu-anchor { display: inline-flex; }
.preview-menu { padding-inline: var(--yj-space-2); color: var(--yj-color-text-primary); border: 0; background: transparent; }
.preview-menu:hover, .preview-menu[aria-expanded="true"] { background: var(--yj-color-control-hover); }
.preview-menu:active { background: var(--yj-color-control-pressed); }
.preview-menu:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
</style>
