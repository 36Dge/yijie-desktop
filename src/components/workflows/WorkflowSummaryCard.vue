<script setup lang="ts">
import { ref } from "vue";
import { NDropdown } from "naive-ui";
import type { MyWorkflow } from "../../domain/workflow-showcase";
import { RouterLink } from "vue-router";
import YjIcon from "../yijie/YjIcon.vue";
defineProps<{ workflow: MyWorkflow; to?: string; example?: boolean }>();
const emit = defineEmits<{ edit: []; delete: [trigger: HTMLButtonElement | null] }>();
const menuVisible = ref(false);
const moreButton = ref<HTMLButtonElement | null>(null);
const menuOptions = [{ label: "编辑", key: "edit", props: { role: "menuitem", tabindex: -1 } }, { label: "删除", key: "delete", props: { role: "menuitem", tabindex: -1 } }];
function select(key: string) {
  moreButton.value?.focus();
  if (key === "edit") emit("edit");
  if (key === "delete") emit("delete", moreButton.value);
}
</script>

<template>
  <article class="workflow-summary-card workflow-showcase-card">
    <header class="workflow-summary-card__header">
      <span class="workflow-summary-card__icon" aria-hidden="true"><YjIcon :name="workflow.icon" size="xl" /></span>
      <span class="workflow-summary-card__badge yj-badge">{{ workflow.badge }}</span>
      <span v-if="example" class="workflow-summary-card__example">示例</span>
      <NDropdown v-if="to" role="menu" aria-label="工作流操作" :options="menuOptions" trigger="click" placement="bottom-end" :show="menuVisible" @update:show="menuVisible = $event" @select="select">
        <button ref="moreButton" type="button" class="workflow-summary-card__more workflow-showcase-control yj-control yj-control--icon"
          :aria-label="`${workflow.title}，更多`" aria-haspopup="menu" :aria-expanded="menuVisible" @click.stop="moreButton?.focus()"><YjIcon name="more" size="sm" /></button>
      </NDropdown>
      <span v-else class="workflow-summary-card__more yj-control yj-control--icon"
        :aria-label="`${workflow.title}，更多，仅展示`" role="img"><YjIcon name="more" size="sm" /></span>
    </header>
    <div class="workflow-summary-card__body">
      <h3 class="workflow-summary-card__title">
        <RouterLink v-if="to" :to="to" :title="workflow.description" class="workflow-summary-card__link" :aria-label="`打开 ${workflow.title}`">{{ workflow.title }}</RouterLink>
        <template v-else>{{ workflow.title }}</template>
      </h3>
      <p class="workflow-summary-card__description">{{ workflow.description }}</p>
    </div>
    <p class="workflow-summary-card__modified">
      <YjIcon name="pending" size="xs" />
      <span>修改于 <time :datetime="workflow.modifiedAt.replace(' ', 'T')">{{ workflow.modifiedAt }}</time></span>
    </p>
  </article>
</template>

<style scoped>
.workflow-summary-card {
  position: relative;
  isolation: isolate;
  display: flex;
  min-width: 0;
  min-height: calc(var(--yj-space-16) * 3 + var(--yj-space-8));
  flex-direction: column;
  gap: var(--yj-space-4);
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-card);
  box-shadow: none;
}

.workflow-summary-card__link { color: inherit; text-decoration: none; }
.workflow-summary-card__link::after { position: absolute; inset: 0; content: ""; border-radius: var(--yj-radius-lg); }
.workflow-summary-card__link:focus-visible { outline: none; }
.workflow-summary-card__link:focus-visible::after { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.workflow-summary-card__example { color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }

.workflow-summary-card__header {
  display: flex;
  align-items: center;
  gap: var(--yj-space-3);
}

.workflow-summary-card__icon {
  display: inline-flex;
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: transparent;
}

.workflow-summary-card__icon :deep(.yj-icon) {
  color: inherit;
}

.workflow-summary-card__more {
  position: relative;
  z-index: var(--yj-z-workflow-card-action);
  margin-left: auto;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
}

.workflow-summary-card__more :deep(.yj-icon) {
  color: inherit;
}

.workflow-summary-card__body {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-2);
}

.workflow-summary-card__title,
.workflow-summary-card__description,
.workflow-summary-card__modified {
  margin: 0;
}

.workflow-summary-card__title {
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
  overflow-wrap: anywhere;
  text-wrap: balance;
}

.workflow-summary-card__badge {
  color: var(--yj-color-text-primary);
  background: var(--yj-color-control-hover);
}

.workflow-summary-card__description {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--yj-color-text-body);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.workflow-summary-card__modified {
  display: flex;
  align-items: center;
  gap: var(--yj-space-2);
  margin-top: auto;
  padding-top: var(--yj-space-4);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  font-variant-numeric: tabular-nums;
}

.workflow-summary-card__modified :deep(.yj-icon) {
  color: inherit;
}
</style>
