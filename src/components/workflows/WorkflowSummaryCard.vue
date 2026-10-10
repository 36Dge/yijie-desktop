<script setup lang="ts">
import { computed, ref } from "vue";
import { NDropdown, NPopover } from "naive-ui";
import type { MyWorkflow } from "../../domain/workflow-showcase";
import { RouterLink } from "vue-router";
import YjIcon from "../yijie/YjIcon.vue";
const props = defineProps<{ workflow: MyWorkflow; to?: string; example?: boolean }>();
const emit = defineEmits<{ edit: []; delete: [trigger: HTMLButtonElement | null] }>();
const published = computed(() => props.workflow.status === "published");
const actionLabel = computed(() => published.value ? "进入工作流" : "进入编辑");
const exampleNoticeVisible = ref(false);
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
    <header class="workflow-summary-card__header workflow-showcase-card__header">
      <span class="workflow-summary-card__icon workflow-showcase-card__icon" aria-hidden="true"><YjIcon :name="workflow.icon" size="xl" /></span>
      <span v-if="example" class="workflow-summary-card__example yj-badge">示例</span>
      <NDropdown v-if="to" role="menu" aria-label="工作流操作" :options="menuOptions" trigger="click" placement="bottom-end" :show="menuVisible" @update:show="menuVisible = $event" @select="select">
        <button ref="moreButton" type="button" class="workflow-summary-card__more workflow-showcase-control yj-control yj-control--icon"
          :aria-label="`${workflow.title}，更多`" aria-haspopup="menu" :aria-expanded="menuVisible" @click.stop="moreButton?.focus()"><YjIcon name="more" size="sm" /></button>
      </NDropdown>
    </header>
    <div class="workflow-summary-card__body workflow-showcase-card__body">
      <h3 class="workflow-summary-card__title workflow-showcase-card__title">
        <RouterLink v-if="to" :to="to" :title="workflow.description" class="workflow-summary-card__link" :aria-label="`打开 ${workflow.title}`">{{ workflow.title }}</RouterLink>
        <template v-else>{{ workflow.title }}</template>
      </h3>
      <p class="workflow-summary-card__description workflow-showcase-card__description" :title="workflow.description">{{ workflow.description }}</p>
    </div>
    <div class="workflow-summary-card__labels workflow-showcase-card__metadata" aria-label="工作流标签与节点数量">
      <span class="workflow-summary-card__badge workflow-showcase-card__badge yj-badge">{{ workflow.badge }}</span>
      <span class="workflow-summary-card__nodes">{{ workflow.nodeCount }} 个节点</span>
    </div>
    <footer class="workflow-summary-card__footer workflow-showcase-card__footer">
      <span class="workflow-summary-card__status" :class="{ 'workflow-summary-card__status--published': published }">
        <YjIcon :name="published ? 'check' : 'pending'" size="xs" />{{ published ? '已发布' : '未发布' }}
      </span>
      <RouterLink v-if="to" :to="to" class="workflow-summary-card__action workflow-card-action workflow-showcase-control yj-control"
        :aria-label="`${actionLabel}：${workflow.title}`"><YjIcon v-if="!published" name="edit" size="sm" />{{ actionLabel }}<YjIcon v-if="published" name="arrowRight" size="sm" /></RouterLink>
      <NPopover v-else trigger="click" placement="bottom-end" :show="exampleNoticeVisible" @update:show="exampleNoticeVisible = $event">
        <template #trigger>
          <button type="button" class="workflow-summary-card__action workflow-card-action workflow-showcase-control yj-control"
            :aria-label="`${actionLabel}：${workflow.title}`" :aria-expanded="exampleNoticeVisible" @keyup.esc="exampleNoticeVisible = false">
            <YjIcon v-if="!published" name="edit" size="sm" />{{ actionLabel }}<YjIcon v-if="published" name="arrowRight" size="sm" />
          </button>
        </template>
        <p class="workflow-summary-card__notice" role="status">此工作流为示例方案，暂未开放。可通过「创建工作流」编排自己的流程。</p>
      </NPopover>
    </footer>
  </article>
</template>

<style scoped>
.workflow-summary-card__link { color: inherit; text-decoration: none; }
.workflow-summary-card__link::after { position: absolute; inset: 0; content: ""; border-radius: var(--yj-radius-lg); }
.workflow-summary-card__link:focus-visible { outline: none; }
.workflow-summary-card__link:focus-visible::after { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }
.workflow-summary-card__example { color: var(--yj-color-text-tertiary); border: var(--yj-border-width) solid var(--yj-color-border-subtle); }

.workflow-summary-card__more {
  position: relative;
  z-index: var(--yj-z-workflow-card-action);
  margin-left: auto;
  flex: none;
  border: var(--yj-border-width) solid transparent;
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
}

.workflow-summary-card__more :deep(.yj-icon) {
  color: inherit;
}

.workflow-summary-card__nodes {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.workflow-summary-card__status :deep(.yj-icon) { color: inherit; }

.workflow-summary-card__status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--yj-space-1);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  white-space: nowrap;
}

.workflow-summary-card__status--published { color: var(--yj-color-semantic-success-ink); }

.workflow-summary-card__action {
  position: relative;
  z-index: var(--yj-z-workflow-card-action);
  margin-left: auto;
  text-decoration: none;
}

.workflow-summary-card__notice {
  max-width: calc(var(--yj-space-16) * 4);
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

</style>
