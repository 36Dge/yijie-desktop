<script setup lang="ts">
import YjIcon from "../yijie/YjIcon.vue";
import { MAX_PREVIEW_TABS } from "../../domain/conversation-file-preview";
import { useConversationDocumentPreview } from "../../composables/useConversationDocumentPreview";
const props = defineProps<{ contextId: string | null; scopeKey: string; enabled: boolean }>();
const emit = defineEmits<{ expanded: [value: boolean]; restoreTrigger: [] }>();
const { opened, state, active, geometry, metadata, phase, error, notice, dragging, capacityText, toggle, openFile, collapse, createTab, selectTab, closeTab, keyTab, navigate, resetWidth, keyResize, startDrag, moveDrag, endDrag, reload } = useConversationDocumentPreview(props, emit);
defineExpose({ toggle, openFile, opened });
</script>

<template>
  <div ref="root" class="document-workspace" :class="{ 'document-workspace--open': opened, 'document-workspace--dragging': dragging }" :style="opened ? { gridTemplateColumns: `minmax(0, 1fr) 1px ${geometry.right}px` } : undefined">
    <div class="document-workspace__chat"><slot /></div>
    <div v-if="opened" ref="separator" class="document-workspace__separator" role="separator" aria-orientation="vertical" aria-label="调整对话与文件预览宽度" :aria-valuemin="geometry.min" :aria-valuemax="geometry.max" :aria-valuenow="geometry.right" tabindex="0" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag(true)" @pointercancel="endDrag(false)" @lostpointercapture="endDrag(false)" @keydown="keyResize" @keydown.esc.prevent="endDrag(false)" @dblclick="resetWidth" />
    <aside v-if="opened" ref="panel" class="document-sidebar" aria-label="文件预览">
      <div class="document-sidebar__tabs">
        <div ref="tabStrip" class="document-sidebar__tablist" role="tablist" aria-label="预览标签页">
          <div v-for="tab in state.tabs" :key="tab.id" class="document-sidebar__tab-wrap" :data-preview-tab="tab.id" :class="{ 'is-active': tab.id === state.activeId }">
            <button :id="`preview-tab-${tab.id}`" type="button" role="tab" :data-tab-id="tab.id" :aria-selected="tab.id === state.activeId" aria-controls="conversation-file-preview" :tabindex="tab.id === state.activeId ? 0 : -1" :title="tab.file ? `${tab.file.name} · ${tab.file.source.kind === 'artifact' ? '生成产物' : '已发送附件'}` : '新标签页'" @click="selectTab(tab.id)" @keydown="keyTab($event, tab.id)"><YjIcon name="file" size="sm" /><span>{{ tab.file?.name ?? '新标签页' }}</span></button>
            <button class="document-sidebar__tab-close" type="button" :aria-label="`关闭 ${tab.file?.name ?? '新标签页'}`" @click="closeTab(tab.id)"><YjIcon name="dismiss" size="xs" /></button>
          </div>
        </div>
        <button ref="addButton" type="button" class="yj-control yj-control--icon" aria-label="新标签页" :title="state.tabs.length >= MAX_PREVIEW_TABS ? capacityText : '新标签页'" :disabled="state.tabs.length >= MAX_PREVIEW_TABS" @click="createTab"><YjIcon name="plus" size="sm" /></button>
        <button type="button" class="yj-control yj-control--icon" aria-label="收起文件预览" title="收起文件预览" @click="collapse()"><YjIcon name="previewSidebar" size="sm" /></button>
      </div>
      <div v-if="active?.file" class="document-sidebar__heading"><span :title="active.file.name">{{ active.file.name }}</span><small>只读预览</small></div>
      <div v-if="metadata && phase === 'ready'" class="document-sidebar__reading" aria-label="阅读选项">
        <select v-if="metadata.sections.length" :value="metadata.section" :aria-label="metadata.kind === 'xlsx' ? '工作表' : '页码'" @change="navigate(Number(($event.target as HTMLSelectElement).value), 0)"><option v-for="section in metadata.sections" :key="section.id" :value="section.id">{{ section.label }}</option></select>
        <button v-if="metadata.previousOffset !== null" type="button" @click="navigate(metadata!.section, metadata!.previousOffset!)">上一段</button>
        <button v-if="metadata.nextOffset !== null" type="button" @click="navigate(metadata!.section, metadata!.nextOffset!)">下一段</button>
        <select :value="active?.location.zoom ?? 1" aria-label="阅读缩放" @change="navigate(metadata!.section, metadata!.offset, Number(($event.target as HTMLSelectElement).value))"><option :value="0.75">75%</option><option :value="1">适合宽度</option><option :value="1.5">150%</option><option :value="2">200%</option></select>
      </div>
      <p v-if="metadata?.notice" class="document-sidebar__notice" role="status">{{ metadata.notice }}</p>
      <div id="conversation-file-preview" ref="viewport" class="document-sidebar__viewport" role="tabpanel" :aria-labelledby="active ? `preview-tab-${active.id}` : undefined" :aria-label="active ? undefined : '空白文件预览'" :aria-busy="phase === 'loading'" tabindex="0">
        <div v-if="phase === 'empty'" class="document-sidebar__empty"><YjIcon name="file" size="xl" /><strong>当前没有文件展示</strong><p>请尝试在对话流中完成任务，生成一个产物；点击对话中的文件，即可在此预览。</p></div>
        <div v-else-if="phase === 'loading'" class="document-sidebar__empty" role="status"><YjIcon name="loading" size="lg" /><p>正在加载预览…</p></div>
        <div v-else-if="phase === 'paused'" class="document-sidebar__empty" role="status"><p>预览已暂停，恢复后继续</p></div>
        <div v-else-if="phase === 'error'" class="document-sidebar__empty" role="status"><YjIcon name="file" size="xl" /><p>{{ error?.text }}</p><button v-if="error?.retryable" type="button" class="yj-control yj-control--regular" @click="reload(false)">重新加载</button></div>
        <span v-else class="document-sidebar__sr-status" role="status">{{ active?.file?.name }}，只读内容已加载</span>
      </div>
    </aside>
    <div v-if="notice" class="document-workspace__notice" role="status">{{ notice }}</div>
  </div>
</template>

<style scoped>
.document-workspace { display:grid; grid-template-columns:minmax(0,1fr); width:100%; height:100%; min-width:0; min-height:0; position:relative; overflow:hidden; }
.document-workspace__chat { min-width:0; min-height:0; height:100%; container-type:inline-size; }
.document-workspace__separator { position:relative; z-index:var(--yj-z-preview-separator); background:var(--yj-color-border-default); cursor:col-resize; touch-action:none; }
.document-workspace__separator::after { content:""; position:absolute; top:0; bottom:0; left:50%; width:var(--yj-space-2); transform:translateX(-50%); }
.document-workspace__separator:hover,.document-workspace__separator:focus-visible { background:var(--yj-color-text-secondary); outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.document-workspace--dragging { cursor:col-resize; user-select:none; }
.document-sidebar { min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--yj-color-bg-page); }
.document-sidebar > .document-sidebar__tabs > button { appearance:none; border:var(--yj-border-width) solid transparent; background:transparent; box-shadow:none; color:var(--yj-color-text-primary); cursor:pointer; }
.document-sidebar > .document-sidebar__tabs > button:hover:not(:disabled) { background:var(--yj-color-control-hover); }
.document-sidebar > .document-sidebar__tabs > button:active:not(:disabled) { background:var(--yj-color-control-pressed); }
.document-sidebar > .document-sidebar__tabs > button:disabled { color:var(--yj-color-text-disabled); cursor:default; }
.document-sidebar__tabs { display:flex; align-items:center; gap:var(--yj-space-1); min-height:var(--yj-layout-preview-tabs-height); padding-inline:var(--yj-space-2); border-bottom:var(--yj-border-width) solid var(--yj-color-border-subtle); }
.document-sidebar__tablist { display:flex; flex:1; min-width:0; overflow-x:auto; scrollbar-width:thin; }
.document-sidebar__tab-wrap { display:flex; align-items:center; flex:none; max-width:var(--yj-layout-preview-tab-max); border-radius:var(--yj-radius-md); }
.document-sidebar__tab-wrap.is-active { background:var(--yj-color-control-hover); }
.document-sidebar__tab-wrap button { display:flex; align-items:center; gap:var(--yj-space-2); min-width:0; border:0; background:transparent; color:var(--yj-color-text-secondary); cursor:pointer; padding:var(--yj-space-2); font:inherit; }
.document-sidebar__tab-wrap.is-active [role="tab"] { color:var(--yj-color-text-primary); }
.document-sidebar__tab-wrap [role="tab"] span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.document-sidebar__tab-close { flex:none; }
.document-sidebar button:focus-visible,.document-sidebar select:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:calc(var(--yj-space-1) * -1); }
.document-sidebar__heading { display:flex; align-items:center; gap:var(--yj-space-3); min-height:var(--yj-layout-preview-heading-height); padding-inline:var(--yj-space-4); border-bottom:var(--yj-border-width) solid var(--yj-color-border-subtle); }
.document-sidebar__heading > span { flex:1; min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; color:var(--yj-color-text-primary); }
.document-sidebar__heading small { flex:none; color:var(--yj-color-text-secondary); }
.document-sidebar__reading { display:flex; align-items:center; flex-wrap:wrap; gap:var(--yj-space-2); padding:var(--yj-space-2) var(--yj-space-4); }
.document-sidebar__reading select,.document-sidebar__reading button { max-width:100%; padding:var(--yj-space-1) var(--yj-space-2); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); background:var(--yj-color-bg-page); color:var(--yj-color-text-primary); font:inherit; }
.document-sidebar__viewport { flex:1; position:relative; min-height:0; min-width:0; overflow:hidden; }
.document-sidebar__empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--yj-space-3); height:100%; padding:var(--yj-space-8); text-align:center; color:var(--yj-color-text-secondary); }
.document-sidebar__empty strong { color:var(--yj-color-text-primary); font-weight:var(--yj-font-weight-semibold); }
.document-sidebar__empty p { max-width:var(--yj-layout-preview-empty-max); margin:0; }
.document-sidebar__notice,.document-workspace__notice { color:var(--yj-color-text-secondary); padding:var(--yj-space-2) var(--yj-space-4); margin:0; font-size:var(--yj-font-size-caption); }
.document-workspace__notice { position:absolute; bottom:var(--yj-space-4); left:var(--yj-space-4); right:var(--yj-space-4); background:var(--yj-color-bg-card); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); z-index:var(--yj-z-preview-notice); }
.document-sidebar__sr-status { position:absolute; width:1px; height:1px; clip-path:inset(50%); overflow:hidden; }
@container (max-width:639px) { .document-workspace__chat :deep(.chat-workspace__header),.document-workspace__chat :deep(.chat-workspace__conversation),.document-workspace__chat :deep(.chat-workspace__composer) { padding-inline:var(--yj-space-4); } }
</style>
