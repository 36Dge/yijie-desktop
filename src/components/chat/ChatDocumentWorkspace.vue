<script setup lang="ts">
import ChatArtifactReport from "./ChatArtifactReport.vue";
import { chatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import { NModal, NTooltip } from "naive-ui";
import YjIcon from "../yijie/YjIcon.vue";
import { MAX_PREVIEW_TABS } from "../../domain/conversation-file-preview";
import { useConversationDocumentPreview } from "../../composables/useConversationDocumentPreview";
const props = defineProps<{ contextId: string | null; scopeKey: string; enabled: boolean }>();
const emit = defineEmits<{ expanded: [value: boolean]; restoreTrigger: [] }>();
const { opened, media, closeMedia, syncViewport, fullscreen, fullscreenTarget, state, active, geometry, metadata, phase, error, notice, dragging, capacityText, toggle, toggleFullscreen, openFile, collapse, createTab, selectTab, closeTab, keyTab, navigate, resetWidth, keyResize, startDrag, moveDrag, endDrag, reload } = useConversationDocumentPreview(props, emit);
defineExpose({ toggle, openFile, opened });
</script>

<template>
  <div ref="root" class="document-workspace" :class="{ 'document-workspace--open': opened, 'document-workspace--dragging': dragging, 'document-workspace--notice': notice && !fullscreen }" :style="opened ? { gridTemplateColumns: `minmax(0, 1fr) 1px ${geometry.right}px` } : undefined">
    <div class="document-workspace__chat" :inert="fullscreen"><slot /></div>
    <div v-if="opened" v-show="!fullscreen" ref="separator" class="document-workspace__separator" role="separator" aria-orientation="vertical" aria-label="调整对话与文件预览宽度" :aria-valuemin="geometry.min" :aria-valuemax="geometry.max" :aria-valuenow="geometry.right" tabindex="0" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag(true)" @pointercancel="endDrag(false)" @lostpointercapture="endDrag(false)" @keydown="keyResize" @keydown.esc.prevent="endDrag(false)" @dblclick="resetWidth" />
    <Teleport :to="fullscreenTarget ?? 'body'" :disabled="!fullscreen || !fullscreenTarget">
    <aside v-if="opened" ref="panel" class="document-sidebar" :class="{ 'document-sidebar--fullscreen': fullscreen }" aria-label="文件预览">
      <div class="document-sidebar__tabs" data-tauri-drag-region>
        <div ref="tabStrip" class="document-sidebar__tablist" :style="{ '--preview-tab-count': state.tabs.length }" role="tablist" aria-label="预览标签页">
          <div v-for="tab in state.tabs" :key="tab.id" class="document-sidebar__tab-wrap" :data-preview-tab="tab.id" :class="{ 'is-active': tab.id === state.activeId }">
            <button :id="`preview-tab-${tab.id}`" type="button" role="tab" :data-tab-id="tab.id" :aria-selected="tab.id === state.activeId" aria-controls="conversation-file-preview" :tabindex="tab.id === state.activeId ? 0 : -1"  @click="selectTab(tab.id)" @keydown="keyTab($event, tab.id)"><YjIcon name="file" size="sm" :stroke-width="1.5" /><span>{{ tab.file?.name ?? '新标签页' }}</span></button>
            <NTooltip arrow-point-to-center placement="left">
              <template #trigger><button class="document-sidebar__tab-close" type="button" :aria-label="`关闭 ${tab.file?.name ?? '新标签页'}`" @click="closeTab(tab.id)"><YjIcon name="dismiss" size="xs" :stroke-width="1.5" /></button></template>
              关闭
            </NTooltip>
          </div>
        </div>
        <NTooltip arrow-point-to-center placement="left">
            <template #trigger><span class="document-sidebar__control"><button ref="addButton" type="button" class="yj-control yj-control--icon" aria-label="新标签页" :disabled="state.tabs.length >= MAX_PREVIEW_TABS" @click="createTab"><YjIcon name="plus" size="sm" :stroke-width="1.5" /></button></span></template>
            {{ state.tabs.length >= MAX_PREVIEW_TABS ? capacityText : '新标签页' }}
        </NTooltip>
        <div class="document-sidebar__controls" role="group" aria-label="右侧面板操作">
          <NTooltip arrow-point-to-center placement="left">
            <template #trigger><button ref="fullscreenButton" type="button" class="yj-control yj-control--icon" :aria-label="fullscreen ? '退出全屏' : '进入全屏'" :aria-pressed="fullscreen" @click="toggleFullscreen"><YjIcon :name="fullscreen ? 'exitFullscreen' : 'enterFullscreen'" size="sm" :stroke-width="1.5" /></button></template>
            {{ fullscreen ? '退出全屏' : '进入全屏' }}
          </NTooltip>
          <NTooltip arrow-point-to-center placement="left">
            <template #trigger><button type="button" class="yj-control yj-control--icon" aria-label="收起右侧面板" @click="collapse()"><YjIcon name="previewSidebar" size="sm" :stroke-width="1.5" /></button></template>
            收起右侧面板
          </NTooltip>
        </div>
      </div>
      <div v-if="!media && phase === 'ready' && metadata && (metadata.sections.length > 1 || metadata.previousOffset !== null || metadata.nextOffset !== null)"
        class="document-sidebar__reading" aria-label="阅读选项">
        <select v-if="metadata.sections.length > 1" :value="metadata.section" :aria-label="metadata.kind === 'xlsx' ? '工作表' : '页码'" @change="navigate(Number(($event.target as HTMLSelectElement).value), 0)"><option v-for="section in metadata.sections" :key="section.id" :value="section.id">{{ section.label }}</option></select>
        <button v-if="metadata.previousOffset !== null" type="button" @click="navigate(metadata!.section, metadata!.previousOffset!)">上一段</button>
        <button v-if="metadata.nextOffset !== null" type="button" @click="navigate(metadata!.section, metadata!.nextOffset!)">下一段</button>
      </div>
      <p v-if="!media && metadata?.notice" class="document-sidebar__notice" role="status">{{ metadata.notice }}</p>
      <p v-if="notice && fullscreen" class="document-sidebar__notice" role="status">{{ notice }}</p>
      <div id="conversation-file-preview" ref="viewport" class="document-sidebar__viewport" role="tabpanel" :aria-labelledby="active ? `preview-tab-${active.id}` : undefined" :aria-label="active ? undefined : '空白文件预览'" :aria-busy="phase === 'loading'" tabindex="0">
        <div v-if="media" class="document-sidebar__empty">关闭媒体预览后继续阅读</div>
        <div v-else-if="phase === 'artifact' && active?.file?.artifact && contextId" :key="active.id + contextId" class="document-sidebar__artifact">
          <ChatArtifactReport :artifact="active.file.artifact" :context-id="contextId" :client="chatArtifactReportNativeClient" preview-only />
        </div>
        <div v-else-if="phase === 'empty'" class="document-sidebar__empty"><YjIcon name="file" size="xl" /><strong>当前没有文件展示</strong><p>请尝试在对话流中完成任务，生成一个产物；点击对话中的文件，即可在此预览。</p></div>
        <div v-else-if="phase === 'loading'" class="document-sidebar__empty" role="status"><YjIcon name="loading" size="lg" /><p>正在加载预览…</p></div>
        <div v-else-if="phase === 'paused'" class="document-sidebar__empty" role="status"><p>预览已暂停，恢复后继续</p></div>
        <div v-else-if="phase === 'error'" class="document-sidebar__empty" role="status"><YjIcon name="file" size="xl" /><p>{{ error?.text }}</p><button v-if="error?.retryable" type="button" class="yj-control yj-control--regular" @click="reload(false)">重新加载</button></div>
        <span v-else class="document-sidebar__sr-status" role="status">{{ active?.file?.name }}，只读内容已加载</span>
      </div>
    </aside>
    </Teleport>
    <NModal :show="Boolean(media)" preset="card" class="document-media-dialog" role="dialog" aria-modal="true"
      :title="media?.file?.name" :aria-label="media?.file?.name" :mask-closable="true"
      @update:show="show => { if (!show) closeMedia(); }" @after-enter="syncViewport">
      <div id="conversation-media-preview" ref="mediaViewport" class="document-media-dialog__viewport" :aria-busy="phase === 'loading'">
        <p v-if="phase === 'loading'" role="status">正在加载预览…</p>
        <p v-else-if="phase === 'paused'" role="status">预览已暂停，恢复后继续</p>
        <template v-else-if="phase === 'error'"><p role="status">{{ error?.text }}</p><button v-if="error?.retryable" type="button" class="yj-control" @click="reload(false)">重新加载</button></template>
      </div>
    </NModal>
    <div v-if="notice && !fullscreen" class="document-workspace__notice" role="status">{{ notice }}</div>
  </div>
</template>

<style scoped>
.document-workspace { display:grid; grid-template-columns:minmax(0,1fr); grid-template-rows:minmax(0,1fr); width:100%; height:100%; min-width:0; min-height:0; position:relative; overflow:hidden; }
.document-workspace--notice { grid-template-rows:minmax(0,1fr) auto; }
.document-workspace__chat { min-width:0; min-height:0; height:100%; container-type:inline-size; }
.document-workspace__separator { position:relative; z-index:var(--yj-z-preview-separator); background:var(--yj-color-border-default); cursor:col-resize; touch-action:none; outline:none; }
.document-workspace__separator::before { content:""; position:absolute; inset:0; background:linear-gradient(to bottom, transparent, var(--yj-color-preview-divider-active) 45%, var(--yj-color-preview-divider-active) 55%, transparent); opacity:0; pointer-events:none; transition:opacity var(--yj-motion-fast); }
/* Keep the grab area in the chat WebView, up to the edge of the native reader. */
.document-workspace__separator::after { content:""; position:absolute; inset-block:0; inset-inline-end:0; width:var(--yj-space-2); }
.document-workspace__separator:hover::before,.document-workspace--dragging .document-workspace__separator::before { opacity:1; }
.document-workspace:not(.document-workspace--dragging) .document-workspace__separator:focus-visible:not(:hover)::before { opacity:1; background:var(--yj-color-focus-ring); width:var(--yj-focus-ring-width); left:50%; transform:translateX(-50%); }
.document-workspace--dragging { cursor:col-resize; user-select:none; }
.document-sidebar { min-width:0; min-height:0; display:flex; flex-direction:column; background:var(--yj-color-bg-page); }
.document-sidebar--fullscreen { position:absolute; inset:0; z-index:var(--yj-z-preview-fullscreen); }
.document-sidebar__controls { display:flex; align-items:center; flex:none; gap:var(--yj-space-1); margin-inline-start:auto; }
.document-sidebar__control { display:inline-flex; flex:none; }
.document-sidebar__tabs .yj-control { appearance:none; border:0; background:transparent; box-shadow:none; color:var(--yj-color-text-primary); cursor:pointer; }
.document-sidebar__tabs .yj-control:hover:not(:disabled) { background:var(--yj-color-control-hover); }
.document-sidebar__tabs .yj-control:active:not(:disabled) { background:var(--yj-color-control-pressed); }
.document-sidebar__tabs .yj-control:disabled { color:var(--yj-color-text-disabled); cursor:default; }
.document-sidebar__tabs { display:flex; flex:none; align-items:center; gap:var(--yj-space-1); height:var(--yj-layout-preview-tabs-height); padding-inline:var(--yj-space-4); border-bottom:var(--yj-border-width) solid var(--yj-color-border-subtle); }
.document-sidebar--fullscreen .document-sidebar__tabs { padding-inline-start:max(var(--yj-space-4),var(--yj-chat-native-controls-inset,0px)); }
.document-sidebar__tablist { display:flex; flex:0 1 auto; width:calc(var(--preview-tab-count) * var(--yj-layout-preview-tab-max) + (var(--preview-tab-count) - 1) * var(--yj-space-1)); min-width:0; gap:var(--yj-space-1); overflow-x:auto; scrollbar-width:none; }
.document-sidebar__tablist::-webkit-scrollbar { display:none; }
.document-sidebar__tab-wrap { display:flex; align-items:center; flex:1 0 var(--yj-layout-preview-tab-min); min-width:var(--yj-layout-preview-tab-min); max-width:var(--yj-layout-preview-tab-max); height:var(--yj-control-height-sm); padding-inline:var(--yj-space-1); border-radius:var(--yj-radius-md); }
.document-sidebar__tab-wrap.is-active { background:var(--yj-color-preview-tab-active); }
.document-sidebar__tab-wrap button { display:flex; align-items:center; gap:var(--yj-space-1); min-width:0; height:100%; border:0; background:transparent; color:var(--yj-color-text-secondary); cursor:pointer; padding:var(--yj-space-1); font:inherit; }
.document-sidebar__tab-wrap [role="tab"] { flex:1; border-radius:var(--yj-radius-sm); }
.document-sidebar__tab-wrap.is-active [role="tab"] { color:var(--yj-color-text-primary); font-weight:var(--yj-font-weight-semibold); }
.document-sidebar__tab-wrap [role="tab"] > .yj-icon { flex:none; }
.document-sidebar__tab-wrap [role="tab"] span { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
.document-sidebar__tab-close { flex:none; width:var(--yj-space-6); justify-content:center; border-radius:var(--yj-radius-sm); }
.document-sidebar__tab-close:hover { color:var(--yj-color-text-primary); background:var(--yj-color-control-pressed); }
.document-sidebar__tabs .yj-control :deep(.yj-icon),.document-sidebar__tab-wrap button :deep(.yj-icon) { color:inherit; }
.document-sidebar button:focus-visible,.document-sidebar select:focus-visible { outline:var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset:calc(var(--yj-space-1) * -1); }
.document-sidebar__reading { display:flex; align-items:center; flex-wrap:wrap; gap:var(--yj-space-2); padding:var(--yj-space-2) var(--yj-space-4); }
.document-sidebar__reading select,.document-sidebar__reading button { max-width:100%; padding:var(--yj-space-1) var(--yj-space-2); border:var(--yj-border-width) solid var(--yj-color-border-default); border-radius:var(--yj-radius-md); background:var(--yj-color-bg-page); color:var(--yj-color-text-primary); font:inherit; }
.document-sidebar__viewport { flex:1; position:relative; min-height:0; min-width:0; overflow:hidden; }
.document-media-dialog { width:min(90vw, 960px); }
.document-media-dialog__viewport { height: min(65vh, 640px); display:grid; align-content:center; justify-items:center; color: var(--yj-color-text-secondary); }
.document-sidebar__artifact { height:100%; overflow:auto; padding:var(--yj-space-4); }
.document-sidebar__empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--yj-space-3); height:100%; padding:var(--yj-space-8); text-align:center; color:var(--yj-color-text-secondary); }
.document-sidebar__empty strong { color:var(--yj-color-text-primary); font-weight:var(--yj-font-weight-semibold); }
.document-sidebar__empty p { max-width:var(--yj-layout-preview-empty-max); margin:0; }
.document-sidebar__notice,.document-workspace__notice { color:var(--yj-color-text-secondary); padding:var(--yj-space-2) var(--yj-space-4); margin:0; font-size:var(--yj-font-size-caption); }
.document-workspace__notice { grid-column:1 / -1; background:var(--yj-color-bg-card); border-top:var(--yj-border-width) solid var(--yj-color-border-default); }
.document-sidebar__sr-status { position:absolute; width:1px; height:1px; clip-path:inset(50%); overflow:hidden; }
@container (max-width:639px) { .document-workspace__chat :deep(.chat-workspace__header),.document-workspace__chat :deep(.chat-workspace__conversation),.document-workspace__chat :deep(.chat-workspace__composer) { padding-inline:var(--yj-space-4); } }
@media (prefers-reduced-motion: reduce) { .document-workspace__separator::before { transition:none; } }
</style>
