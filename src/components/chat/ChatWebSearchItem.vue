<script setup lang="ts">
import {computed} from "vue";
import type {ConversationTimelineItemViewModel} from "../../domain/conversation-timeline";
import ChatTimelineItemShell, {type ChatTimelineDisclosureChange} from "./ChatTimelineItemShell.vue";

const props = defineProps<{item: ConversationTimelineItemViewModel; processPresentation?: boolean}>();
const emit = defineEmits<{"disclosure-change": [change: ChatTimelineDisclosureChange]}>();
const label = computed(() => {
  const complete = props.item.domainStatus === "completed";
  switch (props.item.webSearch?.action) {
    case "openPage": return complete ? "已阅读网页" : "阅读网页";
    case "findInPage": return complete ? "已查找网页内容" : "查找网页内容";
    case "search": return complete ? "已搜索网页" : "搜索网页";
    default: return "网页活动";
  }
});
const status = computed(() => props.item.busy ? "进行中" : props.item.domainStatus === "completed" ? "已完成" : "记录未完整结束");
</script>

<template>
  <ChatTimelineItemShell :item="item" :label="label" :status-label="status"
    icon="skillCrossBorderSelection" :process-presentation="processPresentation"
    collapsible :default-expanded="false" @disclosure-change="emit('disclosure-change', $event)">
    <div class="chat-web-search" aria-label="网页活动详情">
      <p v-if="item.activityLabel" role="note">{{ item.activityLabel }}</p>
      <ul v-if="item.webSearch?.queries.length" aria-label="搜索内容">
        <li v-for="(query, index) in item.webSearch.queries" :key="index">{{ query }}</li>
      </ul>
      <p v-if="item.webSearch?.pageLabel">网页：{{ item.webSearch.pageLabel }}</p>
      <p v-if="item.webSearch?.pattern">查找：{{ item.webSearch.pattern }}</p>
      <section v-if="item.webSearch?.sources?.length" aria-label="搜索来源">
        <p>搜索来源</p>
        <p class="chat-web-search__source-note">以下页面由搜索返回，不代表回答已逐项引用或核验。</p>
        <ul>
          <li v-for="source in item.webSearch.sources" :key="source.url">
            <span v-if="source.title">{{ source.title }} · </span>{{ source.url }}
          </li>
        </ul>
      </section>
      <p v-else-if="item.webSearch?.action === 'search'">该记录未提供可展示的搜索来源。</p>
      <p v-if="!item.webSearch || (!item.webSearch.queries.length && !item.webSearch.pageLabel && !item.webSearch.pattern)">该记录未提供可展示的搜索详情。</p>
    </div>
  </ChatTimelineItemShell>
</template>

<style scoped>
.chat-web-search { display: grid; gap: var(--yj-space-2); color: var(--yj-color-text-secondary); overflow-wrap: anywhere; }
.chat-web-search p, .chat-web-search ul { margin: 0; }
.chat-web-search ul { padding-inline-start: var(--yj-space-4); }
.chat-web-search section { display: grid; gap: var(--yj-space-2); }
.chat-web-search__source-note { color: var(--yj-color-text-tertiary); font-size: var(--yj-font-size-caption); }
</style>
