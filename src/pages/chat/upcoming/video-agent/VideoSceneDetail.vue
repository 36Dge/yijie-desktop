<script setup lang="ts">
import { ref, useId } from "vue";
import { NModal } from "naive-ui";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import ScenarioDetail from "../agent/ScenarioDetail.vue";
import SamplePlayer from "./SamplePlayer.vue";
import type { VideoScene, VideoSceneId } from "./scenes";

const props = defineProps<{ scene: VideoScene }>();
const emit = defineEmits<{ apply: [id: VideoSceneId] }>();
const result = ref<InstanceType<typeof SamplePlayer>>();
const source = ref<"image" | "reference" | null>(null);
const titleId = useId();
const closeButton = ref<HTMLButtonElement>();
const imageFailed = ref(false);
const imageAttempt = ref(0);
let opener: HTMLButtonElement | null = null;

function openSource(kind: "image" | "reference", event: MouseEvent) {
  opener = event.currentTarget as HTMLButtonElement;
  result.value?.pausePlayback();
  source.value = kind;
  imageFailed.value = false;
}
function restoreFocus() {
  opener?.focus({ preventScroll: true });
  opener = null;
}
function useExample() {
  result.value?.resetPlayback();
  emit("apply", props.scene.id);
}
</script>

<template>
  <ScenarioDetail :title="scene.title" :description="scene.description" :output-label="`成片 · ${scene.duration} 秒 · 9:16`" @apply="useExample">
    <template #output>
      <div class="video-result"><SamplePlayer ref="result" :clip="scene.result" /></div>
    </template>
    <template #materials>
      <button type="button" :aria-label="'查看' + scene.input.name" @click="openSource('image', $event)">
        <img :src="scene.input.thumbnail" alt="" draggable="false" />{{ scene.input.name }}
      </button>
      <button v-if="scene.reference" type="button" :aria-label="scene.reference.label" @click="openSource('reference', $event)">
        <img :src="scene.reference.poster" alt="" draggable="false" />{{ scene.reference.name }}<YjIcon name="squarePlay" size="xs" tone="muted" />
      </button>
    </template>
  </ScenarioDetail>
  <NModal :show="source !== null" :auto-focus="false" @update:show="!$event && (source = null)"
    @after-enter="closeButton?.focus({ preventScroll: true })" @after-leave="restoreFocus">
    <section v-if="source" class="video-material" role="dialog" aria-modal="true" :aria-labelledby="titleId">
      <header>
        <h2 :id="titleId">{{ source === 'reference' ? scene.reference?.name : scene.input.name }}</h2>
        <button ref="closeButton" type="button" aria-label="关闭素材预览" @click="source = null"><YjIcon name="dismiss" size="sm" /></button>
      </header>
      <div class="video-material__media">
        <SamplePlayer v-if="source === 'reference' && scene.reference" :clip="scene.reference" />
        <template v-else>
          <img :key="imageAttempt" :src="scene.input.src" :alt="scene.input.alt" @error="imageFailed = true" @load="imageFailed = false" />
          <button v-if="imageFailed" type="button" class="video-material__retry" @click="imageFailed = false; imageAttempt++">图片加载失败，点击重试</button>
        </template>
      </div>
    </section>
  </NModal>
</template>

<style scoped>
.video-result {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  width: 100%;
  aspect-ratio: 3 / 2;
  border-radius: var(--yj-image-gallery-radius);
  overflow: hidden;
}
.video-material {
  width: min(600px, calc(100% - var(--yj-space-8)));
  overflow: hidden;
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-modal);
}
.video-material header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-3); padding: var(--yj-space-2) var(--yj-space-4); }
.video-material h2 { margin: 0; font-size: var(--yj-font-size-card-title); }
.video-material header button { display: grid; place-items: center; width: var(--yj-control-height-sm); height: var(--yj-control-height-sm); border: 0; border-radius: var(--yj-radius-sm); background: transparent; }
.video-material header button:hover { background: var(--yj-color-control-hover); }
.video-material button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: -2px; }
.video-material__media {
  position: relative;
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  height: min(620px, 68vh, calc(var(--yj-ui-viewport-height, 100vh) - 92px));
  background: var(--yj-color-bg-composer-tray);
}
.video-material__media > img { display: block; width: 100%; height: 100%; object-fit: contain; }
.video-material__retry { position: absolute; inset: 0; border: 0; color: var(--yj-color-text-secondary); background: var(--yj-color-bg-card); }
</style>
