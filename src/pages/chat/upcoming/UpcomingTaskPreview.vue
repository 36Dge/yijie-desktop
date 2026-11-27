<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useMessage, type MessageReactive } from "naive-ui";
import ChatHomeOpening from "../../../components/chat/ChatHomeOpening.vue";
import ChatHomeMascot from "../../../components/chat/ChatHomeMascot.vue";
import YjIcon from "../../../components/yijie/YjIcon.vue";
import YjTooltip from "../../../components/yijie/YjTooltip.vue";
import CommerceTaskNav from "./CommerceTaskNav.vue";
import PreviewMenu from "./PreviewMenu.vue";
import { homeCommerceTasks, type HomeCommerceTask } from "./commerce-tasks";
import ImageScenarioGallery from "./image-agent/ImageScenarioGallery.vue";
import AgentPromptChips from "./agent/AgentPromptChips.vue";
import AgentConfigDialog from "./agent/AgentConfigDialog.vue";
import type { ConfigSection, OptionalChip } from "./agent/config";
import { describeConfig, type AgentConfig } from "./agent/presentation";
import { demoConfig, newImageAgentState, type ImageAgentState } from "./image-agent/draft";
import type { SceneId } from "./image-agent/scenes";
import VideoScenarioGallery from "./video-agent/VideoScenarioGallery.vue";
import SelectionScenarioGallery from "./sourcing/SelectionScenarioGallery.vue";
import { newVideoAgentState, videoDemoConfig, type VideoAgentState } from "./video-agent/draft";
import type { VideoSceneId } from "./video-agent/scenes";
import "./agent/agent-theme.css";

const text = defineModel<string>("text", { required: true });
const task = defineModel<HomeCommerceTask>("task", { required: true });
const imageState = defineModel<ImageAgentState>("imageState", { default: newImageAgentState });
const videoState = defineModel<VideoAgentState>("videoState", { default: newVideoAgentState });
const input = ref<HTMLTextAreaElement>();
const section = ref<ConfigSection | null>(null);
const activeConfig = computed<AgentConfig | null>(() => {
  if (task.value === "image") return imageState.value.config;
  if (task.value === "video") return videoState.value.config;
  return null;
});
const sendable = computed(() => activeConfig.value ? !describeConfig(activeConfig.value).missing.length : !!text.value.trim());
const composing = ref(false);
const message = useMessage();
let notice: MessageReactive | undefined;

async function focusPrompt() {
  await nextTick();
  input.value?.focus({ preventScroll: true });
  input.value?.scrollIntoView({ block: "nearest" });
}
function applyScene(id: SceneId) {
  imageState.value = { selected: id, config: demoConfig(id, imageState.value.config) };
  void focusPrompt();
}
function applyVideoScene(id: VideoSceneId) {
  videoState.value = { selected: id, config: videoDemoConfig(id) };
  void focusPrompt();
}
function confirmConfig(config: AgentConfig) {
  if (config.kind === "video") videoState.value = { selected: config.direction, config };
  else imageState.value = { selected: config.direction, config };
  section.value = null;
  void focusPrompt();
}
function removeToken(token: OptionalChip) {
  const config = activeConfig.value;
  if (config && !config.removed.includes(token)) config.removed.push(token);
  void focusPrompt();
}
function backspace(event: KeyboardEvent) {
  const config = activeConfig.value;
  if (!config || text.value.length || event.isComposing || composing.value || describeConfig(config).missing.length) return;
  const last = (["settings", "targeting", "direction"] as const).find(key => !config.removed.includes(key));
  if (last) { event.preventDefault(); removeToken(last); }
}
watch(task, () => { section.value = null; });

function serviceNotice() {
  if (notice) return;
  notice = message.info("新版服务未接通真实服务，请切到已发布版本", {
    duration: 3500,
    onAfterLeave: () => { notice = undefined; },
  });
}
function submit() {
  if (sendable.value) serviceNotice();
}
function enter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing || composing.value || event.keyCode === 229) return;
  event.preventDefault();
  submit();
}
function paste(event: ClipboardEvent) {
  if (!event.clipboardData?.types.includes("Files")) return;
  event.preventDefault();
  serviceNotice();
}
function drop(event: DragEvent) {
  if (event.dataTransfer?.types.includes("Files")) serviceNotice();
}
onBeforeUnmount(() => notice?.destroy());
</script>

<template>
  <section class="upcoming-task" aria-labelledby="new-task-title">
    <div class="upcoming-task__content">
      <ChatHomeOpening skip-animation />
      <form class="upcoming-task__composer" aria-label="即将更新任务输入区"
        @submit.prevent="submit" @dragover.prevent @drop.prevent="drop">
        <div class="upcoming-task__header">
          <CommerceTaskNav v-model="task" />
          <div class="upcoming-task__mascot"><ChatHomeMascot ready :skip-animation="!!text" /></div>
        </div>
        <div class="upcoming-task__tray">
          <div class="upcoming-task__field">
            <div class="upcoming-task__prompt" :class="{ 'upcoming-task__prompt--configured': activeConfig }">
              <AgentPromptChips v-if="activeConfig" :config="activeConfig" @open="section = $event" @remove="removeToken" />
              <textarea id="upcoming-task-input" ref="input" v-model="text" :rows="activeConfig ? 1 : 2" aria-label="输入你的任务需求"
                :placeholder="activeConfig ? (activeConfig.kind === 'video' ? '补充镜头、节奏或平台要求···' : '补充画面、卖点或平台要求···') : homeCommerceTasks[task].hint"
                @keydown.enter="enter" @keydown.backspace="backspace" @paste="paste"
                @compositionstart="composing = true" @compositionend="composing = false" />
            </div>
            <div class="upcoming-task__actions">
              <div class="upcoming-task__controls">
                <PreviewMenu label="添加" icon="plus" icon-only :options="['添加图片或文件', '技能', '连接器', '专家']" @select="serviceNotice" />
                <PreviewMenu label="关联店铺" icon="store" :options="['选择店铺', '授权新店铺']" @select="serviceNotice" />
              </div>
              <div class="upcoming-task__controls">
                <PreviewMenu label="MiniMax-M3" icon="modelMiniMax" :options="['MiniMax-M3', 'Kimi K3.1 Pro']" @select="serviceNotice" />
                <YjTooltip text="发送任务">
                  <button type="submit" class="upcoming-task__send yj-control yj-control--icon" :disabled="!sendable" aria-label="发送任务">
                    <YjIcon name="send" size="md" />
                  </button>
                </YjTooltip>
              </div>
            </div>
          </div>
          <div class="upcoming-task__settings">
            <PreviewMenu label="选择工作空间" icon="folder" :options="['选择本地文件夹', '新建工作空间']" @select="serviceNotice" />
            <PreviewMenu label="权限设置" icon="shield" :options="['请求批准', '帮我批准', '完全访问']" @select="serviceNotice" />
          </div>
        </div>
      </form>
      <ImageScenarioGallery v-if="task === 'image'" @apply="applyScene" />
      <VideoScenarioGallery v-if="task === 'video'" @apply="applyVideoScene" />
      <SelectionScenarioGallery v-if="task === 'sourcing'" />
      <AgentConfigDialog v-if="activeConfig && section" :config="activeConfig" :section="section" @close="section = null"
        @confirm="confirmConfig" @service="serviceNotice" />
    </div>
  </section>
</template>

<style scoped>
.upcoming-task {
  display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100%;
  padding: var(--yj-space-8); background: var(--yj-color-bg-page);
}
.upcoming-task__content {
  align-self: start; width: 100%;
  margin: var(--yj-layout-chat-entry-top-offset) auto 0;
}
.upcoming-task__composer { container: home-composer / inline-size; width: min(100%, var(--yj-layout-chat-entry-max)); margin: 0 auto; }
.upcoming-task__prompt { border-radius: inherit; }
.upcoming-task__prompt--configured {
  display: flex; flex-wrap: wrap; align-content: flex-start; align-items: baseline; gap: 4px;
  min-height: calc(var(--yj-space-16) + var(--yj-space-4)); padding: var(--yj-space-4); font-size: var(--yj-font-size-body);
}
.upcoming-task .upcoming-task__prompt--configured textarea {
  flex: 1 1 12em; min-width: min(100%, 9em); width: auto; min-height: 25px; padding: 1px 0; border-radius: 0;
}
.upcoming-task__header {
  display: grid; grid-template: minmax(var(--yj-home-mascot-clearance), auto) / minmax(0, 1fr); align-items: end;
}
.upcoming-task__mascot { position: relative; grid-area: 1 / 1; }
.upcoming-task__tray { border-radius: var(--yj-radius-chat-composer); background: var(--yj-color-bg-composer-tray); }
.upcoming-task__field {
  position: relative; border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-chat-composer); background: var(--yj-color-bg-card); box-shadow: var(--yj-shadow-chat-composer);
}
.upcoming-task textarea {
  display: block; box-sizing: border-box; width: 100%; min-height: calc(var(--yj-space-16) + var(--yj-space-4));
  max-height: min(36vh, var(--yj-layout-composer-height)); padding: var(--yj-space-4);
  border: 0; outline: none; border-radius: inherit; color: var(--yj-color-text-primary); background: transparent;
  font: inherit; font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body);
  field-sizing: content; resize: none;
}
.upcoming-task textarea::placeholder { color: var(--yj-color-text-tertiary); opacity: 1; }
.upcoming-task__actions, .upcoming-task__controls, .upcoming-task__settings { display: flex; align-items: center; flex-wrap: wrap; }
.upcoming-task__actions { justify-content: space-between; gap: var(--yj-space-1); padding: 0 var(--yj-space-3) var(--yj-space-3); }
.upcoming-task__controls { gap: var(--yj-space-1); }
.upcoming-task__controls:last-child { margin-inline-start: auto; }
.upcoming-task__settings { gap: var(--yj-space-2); padding: var(--yj-space-1) var(--yj-space-2); }
.upcoming-task__send { border: 0; border-radius: var(--yj-radius-full); color: var(--yj-color-on-brand); background: var(--yj-color-brand-primary); }
.upcoming-task__send :deep(.yj-icon) { color: inherit; }
.upcoming-task__send:hover:enabled { background: var(--yj-color-brand-hover); }
.upcoming-task__send:active:enabled { background: var(--yj-color-brand-active); }
.upcoming-task__send:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); }
.upcoming-task__send:disabled { cursor: not-allowed; color: var(--yj-color-text-disabled); background: var(--yj-color-control-disabled-bg); }
</style>
