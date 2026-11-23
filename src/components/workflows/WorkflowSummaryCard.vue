<script setup lang="ts">
import { computed, ref } from "vue";
import { NDropdown, NPopover } from "naive-ui";
import type { MyWorkflow } from "../../domain/workflow-showcase";
import { RouterLink } from "vue-router";
import YjIcon from "../yijie/YjIcon.vue";
import { workflowCardArtwork } from "../../icons/workflow-artwork";
const props = defineProps<{ workflow: MyWorkflow; to?: string; example?: boolean }>();
const emit = defineEmits<{ edit: []; delete: [trigger: HTMLButtonElement | null]; exampleAction: [] }>();
const published = computed(() => props.workflow.status === "published");
const actionLabel = computed(() => published.value ? "进入工作流" : "进入编辑");
const exampleNoticeVisible = ref(false);
const menuVisible = ref(false);
const moreButton = ref<HTMLButtonElement | null>(null);
const menuOptions = [{ label: "编辑", key: "edit", props: { role: "menuitem", tabindex: -1 } }, { label: "删除", key: "delete", props: { role: "menuitem", tabindex: -1 } }];
function select(key: string) {
  menuVisible.value = false;
  moreButton.value?.focus();
  if (key !== "edit" && key !== "delete") return;
  if (props.example) { emit("exampleAction"); return; }
  if (key === "edit") emit("edit");
  if (key === "delete") emit("delete", moreButton.value);
}
</script>

<template>
  <article class="workflow-summary-card workflow-showcase-card">
    <header class="workflow-showcase-card__header">
      <img class="workflow-showcase-card__icon" :src="workflowCardArtwork(workflow.id)" alt="" aria-hidden="true" draggable="false" />
      <div class="workflow-showcase-card__heading">
        <div class="workflow-showcase-card__context">
          <span>{{ workflow.badge }}</span>
          <span v-if="workflow.nodeCount !== undefined" class="workflow-summary-card__nodes">{{ workflow.nodeCount }} 个节点</span>
          <NDropdown v-if="to || example" role="menu" aria-label="工作流操作" :options="menuOptions" trigger="click" placement="bottom-end"
            :style="{ width: 'min(var(--yj-layout-workflow-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)))' }"
            :show="menuVisible" @update:show="menuVisible = $event" @select="select">
            <button ref="moreButton" type="button" class="workflow-summary-card__more workflow-showcase-control yj-control yj-control--icon"
              :aria-label="`${workflow.title}，更多`" aria-haspopup="menu" :aria-expanded="menuVisible" @click.stop="moreButton?.focus()"><YjIcon name="more" size="sm" /></button>
          </NDropdown>
        </div>
        <h3 class="workflow-summary-card__title workflow-showcase-card__title">
          <RouterLink v-if="to" :to="to" class="workflow-summary-card__link" :aria-label="`打开 ${workflow.title}`">{{ workflow.title }}</RouterLink>
          <template v-else>{{ workflow.title }}</template>
        </h3>
      </div>
    </header>
    <p class="workflow-showcase-card__description">{{ workflow.description }}</p>
    <footer class="workflow-showcase-card__footer">
      <span class="workflow-summary-card__details">
        <span class="workflow-summary-card__status" :class="{ 'workflow-summary-card__status--published': published }">
          <YjIcon :name="published ? 'check' : 'pending'" size="xs" />{{ published ? '已发布' : '未发布' }}
        </span>
        <span v-if="example" class="workflow-showcase-card__badge">示例</span>
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
.workflow-summary-card__title { word-break: normal; text-wrap: balance; }
.workflow-summary-card__link { color: inherit; text-decoration: none; }
.workflow-summary-card__link::after { position: absolute; inset: 0; content: ""; border-radius: var(--yj-radius-xl); }
.workflow-summary-card__link:focus-visible { outline: none; }
.workflow-summary-card__link:focus-visible::after { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: calc(-1 * var(--yj-focus-ring-width)); }

.workflow-summary-card__more {
  position: relative;
  z-index: var(--yj-z-workflow-card-action);
  margin-block: calc(-1 * var(--yj-space-1));
  margin-inline: auto calc(-1 * var(--yj-space-1));
  flex: none;
  border: var(--yj-border-width) solid transparent;
  color: var(--yj-color-text-tertiary);
  background: transparent;
}

.workflow-summary-card__details {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--yj-space-2);
  min-width: 0;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.workflow-summary-card__nodes {
  padding-inline-start: var(--yj-space-1);
  border-inline-start: var(--yj-border-width) solid var(--yj-color-border-default);
  color: var(--yj-color-text-tertiary);
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
  white-space: nowrap;
}

.workflow-summary-card__status--published { color: var(--yj-color-semantic-success-ink); }

.workflow-summary-card__action {
  position: relative;
  z-index: var(--yj-z-workflow-card-action);
  margin-left: auto;
}

.workflow-summary-card__notice {
  max-width: calc(var(--yj-space-16) * 4);
  margin: 0;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
}

</style>
