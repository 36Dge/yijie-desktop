<script setup lang="ts">
import YjTooltip from "../yijie/YjTooltip.vue";
import { computed, ref, useId, watch } from "vue";
import { webSearchQueryTitle } from "../../domain/web-search-presentation";
import type { ConversationTimelineItemViewModel } from "../../domain/conversation-timeline";
import type { ChatTimelineDisclosureChange } from "./ChatTimelineItemShell.vue";
import { sourceHref, sourceInitial, useWebSources } from "../../composables/useWebSources";
import YjIcon from "../yijie/YjIcon.vue";
import ChatShortScrollbar from "./ChatShortScrollbar.vue";

const props = withDefaults(defineProps<{ item: ConversationTimelineItemViewModel; processPresentation?: boolean; searchOccurrence?: number }>(), {searchOccurrence: 1});
const emit = defineEmits<{ "disclosure-change": [change: ChatTimelineDisclosureChange] }>();
const expanded = ref(false);
const viewport = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const { icons, open, openError } = useWebSources(() => props.item, () => expanded.value);
const contentId = `${useId()}-search`;
const sourceNoteId = `${contentId}-note`;
const label = computed(() => {
  switch (props.item.webSearch?.action) {
    case "openPage": return "阅读网页";
    case "findInPage": return "查找网页内容";
    case "search": return props.searchOccurrence > 2 ? `第 ${props.searchOccurrence} 次搜索` : props.searchOccurrence === 2 ? "再次搜索" : "网页搜索";
    default: return "网页活动";
  }
});
// Sources belong to the native activity, not to individual queries. Keep batch
// queries together rather than inventing a per-query result association.
const originalQueries = computed(() => props.item.webSearch?.queries.join("\n") ?? "");
const detail = computed(() => {
  const search = props.item.webSearch;
  return search?.action === "search" ? webSearchQueryTitle(search.queries)
    : [search?.pageLabel, search?.pattern].filter(Boolean).join(" · ");
});
const status = computed(() => props.item.busy ? "进行中" : props.item.domainStatus === "completed" ? "已完成" : "记录未完整结束");
const availabilityMessage = computed(() => props.item.availability === "unavailable" ? "此项内容暂不可用。" : null);
const stateMessage = computed(() => props.item.activityLabel || (!props.item.busy && props.item.domainStatus !== "completed"
  ? "此项记录未完整结束；当前进度待确认。" : null));
const emptyMessage = computed(() => props.item.busy ? "正在等待网页搜索结果…"
  : props.item.webSearch?.action === "search" ? "该记录未提供可展示的搜索来源。"
    : !props.item.webSearch || !detail.value ? "该记录未提供可展示的网页活动详情。" : null);

function toggle() {
  expanded.value = !expanded.value;
  emit("disclosure-change", { itemIdentity: props.item.identity, expanded: expanded.value });
}
watch(() => props.item.identity, () => { expanded.value = false; });
</script>

<template>
  <article class="chat-web-search" data-progress-source="runtime_records" :aria-label="label" :aria-busy="item.busy ? 'true' : 'false'">
    <button class="chat-web-search__toggle" type="button" :aria-expanded="expanded" :aria-controls="contentId"
      :aria-label="`${label}${detail ? ` ${detail}` : ''}，${status}，${expanded ? '收起' : '展开'}`" @click="toggle">
      <YjIcon class="chat-web-search__globe" name="skillCrossBorderSelection" size="xs" :stroke-width="1.5" />
      <span class="chat-web-search__label">{{ label }}</span>
      <YjTooltip v-if="detail" :text="originalQueries || detail"><span  class="chat-web-search__query" >{{ detail }}</span></YjTooltip>
      <YjIcon class="chat-web-search__chevron" :name="expanded ? 'chevronDown' : 'chevronRight'"
        size="xs" :stroke-width="1.5" />
    </button>
    <p v-if="availabilityMessage" class="chat-web-search__notice" role="note">{{ availabilityMessage }}</p>
    <p v-if="stateMessage" class="chat-web-search__notice" role="note">{{ stateMessage }}</p>
    <div v-if="expanded" class="chat-web-search__details">
      <div class="chat-web-search__scroll-frame">
        <div :id="contentId" ref="viewport" class="chat-web-search__viewport" role="region" aria-label="网页活动详情" tabindex="0">
          <div ref="content" class="chat-web-search__content">
          <section v-if="item.webSearch?.sources?.length" :aria-describedby="sourceNoteId" aria-label="搜索来源">
            <p :id="sourceNoteId" class="chat-web-search__sr-only">以下页面由搜索返回，不代表回答已逐项引用或核验。</p>
            <ul class="chat-web-search__sources">
              <li v-for="(source, index) in item.webSearch.sources" :key="`${index}:${source.url}`"
                class="chat-web-search__source">
                <a class="chat-web-search__source-link" :href="sourceHref(source.url)" target="_blank" rel="noopener noreferrer"
                  @click.prevent="open(source.url)" @auxclick.middle.prevent="open(source.url)">
                  <img v-if="icons[source.url]" class="chat-web-search__source-icon" :src="icons[source.url]!" alt="" width="16" height="16"
                    @error="icons[source.url] = null">
                  <span v-else class="chat-web-search__source-fallback" aria-hidden="true">{{ sourceInitial(source.url) }}</span>
                  <span class="chat-web-search__source-title">{{ source.title || source.url }}</span>
                  <span v-if="source.title" class="chat-web-search__sr-only">（{{ source.url }}）</span>
                </a>
              </li>
            </ul>
          </section>
          <p v-else-if="emptyMessage" class="chat-web-search__notice" role="note">{{ emptyMessage }}</p>
          <p v-else class="chat-web-search__notice">{{ detail }}</p>
          </div>
        </div>
        <ChatShortScrollbar :viewport="viewport" :content="content" :controls="contentId" label="滚动网页搜索结果" />
      </div>
    </div>
    <p v-if="openError" class="chat-web-search__notice" role="alert">{{ openError }}</p>
  </article>
</template>

<style scoped>
.chat-web-search {
  min-width: 0;
  color: var(--yj-color-chat-timing);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  font-weight: var(--yj-font-weight-regular);
}
.chat-web-search__toggle {
  display: flex;
  width: fit-content;
  max-width: 100%;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) 0;
  border: 0;
  border-radius: var(--yj-radius-sm);
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.chat-web-search__toggle:hover { color: var(--yj-color-text-primary); }
.chat-web-search__toggle:focus-visible,
.chat-web-search__viewport:focus-visible,
.chat-web-search__source-link:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}
.chat-web-search__toggle .yj-icon { color: inherit; }
.chat-web-search__label { flex: 0 0 auto; }
.chat-web-search__query {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-web-search__chevron { opacity: 0; }
.chat-web-search__toggle:hover .chat-web-search__chevron,
.chat-web-search__toggle:focus-visible .chat-web-search__chevron,
.chat-web-search__toggle[aria-expanded="true"] .chat-web-search__chevron { opacity: 1; }
.chat-web-search__details {
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  margin-top: var(--yj-space-1);
  padding: var(--yj-space-3) var(--yj-space-2);
  border-radius: var(--yj-radius-xl);
  background: var(--yj-color-chat-search-sources-bg);
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}
.chat-web-search__scroll-frame { position: relative; }
.chat-web-search__viewport {
  display: grid;
  max-height: calc(var(--yj-layout-chat-search-max-height) - 2 * var(--yj-space-3));
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scrollbar-width: none;
}
.chat-web-search__viewport::-webkit-scrollbar { display: none; }
.chat-web-search__viewport:focus-visible { outline-offset: 0; }
.chat-web-search__content {
  grid-area: 1 / 1;
  display: grid;
  min-width: 0;
  gap: var(--yj-space-2);
  padding-inline: var(--yj-space-3) calc(var(--yj-space-3) + var(--yj-space-2));
}
.chat-web-search__sources {
  display: grid;
  gap: var(--yj-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}
.chat-web-search__source-link {
  box-sizing: border-box;
  width: calc(100% + var(--yj-space-4));
  margin-inline: calc(-1 * var(--yj-space-2));
  padding: calc(var(--yj-space-1) / 2) var(--yj-space-2);
  color: inherit;
  text-decoration: none;
  border-radius: var(--yj-radius-sm);
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--yj-space-2);
}
.chat-web-search__source { min-width: 0; }
.chat-web-search__source-link:hover,
.chat-web-search__source-link:focus-visible {
  color: var(--yj-color-text-primary);
  background: var(--yj-color-chat-search-source-hover);
  text-decoration: none;
}
.chat-web-search__source-icon, .chat-web-search__source-fallback {
  flex: 0 0 var(--yj-space-4);
  width: var(--yj-space-4);
  height: var(--yj-space-4);
  object-fit: contain;
  border-radius: var(--yj-radius-xs);
}
.chat-web-search__source-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
}
.chat-web-search__source-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-web-search__notice { margin: 0; font-size: var(--yj-font-size-caption); overflow-wrap: anywhere; }
.chat-web-search__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (hover: none) {
  .chat-web-search__chevron { opacity: 1; }
}
</style>
