<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NPopover } from "naive-ui";
import { matchingChatSkills, type ChatSkillSuggestionCatalog } from "../../domain/chat-skills";
import { skillCardArtwork } from "../../icons/skill-artwork";

const props = defineProps<{ catalog: ChatSkillSuggestionCatalog; query: string; listId: string }>();
const emit = defineEmits<{ select: [id: string]; retry: []; close: [] }>();
const overlay = ref<HTMLElement | null>(null);
const list = ref<HTMLElement | null>(null);
const highlighted = ref<string | null>(null);
const options = computed(() => props.catalog.error || props.catalog.loading ? [] : matchingChatSkills(props.catalog.entries, props.query));
const active = computed(() => options.value.find(entry => entry.id === highlighted.value) ?? options.value[0]);
const activeOptionId = computed(() => active.value ? `${props.listId}-${active.value.id}` : undefined);

watch(() => props.query, () => {
  highlighted.value = null;
  if (list.value) list.value.scrollTop = 0;
});

function handleKeydown(event: KeyboardEvent): boolean {
  if (event.key === "Escape") {
    emit("close");
  } else if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
    return false;
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const count = options.value.length;
    if (active.value && count) {
      const step = event.key === "ArrowDown" ? 1 : -1;
      const index = (options.value.indexOf(active.value) + step + count) % count;
      highlighted.value = options.value[index]!.id;
      void nextTick(() => {
        if (activeOptionId.value) document.getElementById(activeOptionId.value)?.scrollIntoView({ block: "nearest" });
      });
    }
  } else if (event.key === "Enter") {
    if (active.value) emit("select", active.value.id);
    else if (props.catalog.error) emit("retry");
  } else {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}

defineExpose({ activeOptionId, handleKeydown });
</script>

<template>
  <Teleport to="body"><div ref="overlay" class="chat-control-overlay" /></Teleport>
  <NPopover :show="true" :to="overlay ?? false" trigger="manual" placement="top-start" raw :animated="false" :show-arrow="false">
    <template #trigger><span class="skill-slash-anchor" aria-hidden="true" /></template>
    <div class="skill-slash-menu chat-control-menu" @mousedown.prevent>
      <div :id="`${listId}-label`" class="skill-slash-menu__title">使用技能</div>
      <ul :id="listId" ref="list" class="skill-slash-menu__list" role="listbox" :aria-labelledby="`${listId}-label`" :aria-busy="catalog.loading">
        <li v-for="entry in options" :id="`${listId}-${entry.id}`" :key="entry.id"
          role="option" :aria-selected="active?.id === entry.id" class="skill-slash-menu__option chat-control-option"
          @mousemove="highlighted = entry.id" @click="emit('select', entry.id)">
          <img class="skill-slash-menu__icon" :src="skillCardArtwork(entry)" alt="" draggable="false" />
          <span class="skill-slash-menu__name">{{ entry.displayName }}</span>
          <span class="skill-slash-menu__description">{{ entry.description }}</span>
        </li>
      </ul>
      <p v-if="catalog.error" class="skill-slash-menu__status" role="alert">
        {{ catalog.error }} <button type="button" tabindex="-1" aria-keyshortcuts="Enter" @click="emit('retry')">重试</button>
      </p>
      <p v-else-if="!options.length" class="skill-slash-menu__status" role="status">
        {{ catalog.loading ? "正在读取技能…" : query ? "没有找到匹配的技能" : "暂无可选用的技能" }}
      </p>
    </div>
  </NPopover>
</template>

<style scoped>
.chat-control-overlay :deep(.n-popover--raw) { box-shadow: none; }
.skill-slash-anchor {
  position: absolute;
  inset-block-start: var(--yj-space-4);
  inset-inline-start: calc(var(--yj-space-4) + var(--connector-prefix-width, 0px));
  height: var(--yj-line-height-body);
  pointer-events: none;
}
.skill-slash-menu {
  width: min(var(--yj-layout-connector-menu-width), calc(var(--yj-ui-viewport-width, 100vw) - var(--yj-space-8)));
  border-radius: var(--yj-radius-xl);
}
.skill-slash-menu__title, .skill-slash-menu__status {
  margin: 0;
  padding: var(--yj-space-2) var(--yj-space-3);
  color: var(--yj-color-text-secondary);
}
.skill-slash-menu__title {
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-regular);
}
.skill-slash-menu__status { font-size: var(--yj-font-size-caption); }
.skill-slash-menu__list {
  list-style: none;
  max-height: min(var(--yj-layout-connector-list-max), calc(var(--yj-ui-viewport-height, 100vh) * .32));
  padding: 0;
  margin: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.skill-slash-menu__option {
  min-height: var(--yj-control-height-sm);
  padding: var(--yj-space-1) var(--yj-space-3);
  gap: var(--yj-space-2);
  border-radius: var(--yj-radius-full);
}
.skill-slash-menu__option[aria-selected="true"] { background: var(--yj-color-control-pressed); }
.skill-slash-menu__option[aria-selected="false"]:hover { background: transparent; }
.skill-slash-menu__icon {
  flex: none;
  width: var(--yj-space-5);
  height: var(--yj-space-5);
  border-radius: var(--yj-radius-xs);
  object-fit: cover;
}
.skill-slash-menu__name, .skill-slash-menu__description { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-slash-menu__name { flex: none; max-width: 55%; font-weight: var(--yj-font-weight-semibold); }
.skill-slash-menu__description { min-width: 0; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.skill-slash-menu__status button { border: 0; background: transparent; color: var(--yj-color-text-primary); font: inherit; text-decoration: underline; cursor: pointer; }
</style>
