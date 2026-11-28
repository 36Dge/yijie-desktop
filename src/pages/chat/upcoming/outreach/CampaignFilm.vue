<script setup lang="ts">
import { ref, useId } from "vue";
import { NModal } from "naive-ui";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import SamplePlayer from "../video-agent/SamplePlayer.vue";
import { videoScenes } from "../video-agent/scenes";
// Two frames from the same local reference clip, at 6.38 s and 2.36 s.
import filmCover from "./assets/workbag-film.webp";

const film = videoScenes.seeding;
const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const close = ref<HTMLButtonElement>();
const titleId = useId();
</script>

<template>
  <button ref="trigger" type="button" class="brief-film" :aria-label="'播放通勤试背参考短片，' + film.duration + ' 秒'" aria-haspopup="dialog" @click="open = true">
    <img class="film-cover" :src="filmCover" alt="" width="928" height="564" decoding="async" />
    <span class="film-caption"><YjIcon name="run" size="xs" /><span>参考短片</span><span class="film-duration">00:{{ String(film.duration).padStart(2, '0') }}</span></span>
  </button>
  <NModal :show="open" :auto-focus="false" @update:show="open = $event"
    @after-enter="close?.focus({ preventScroll: true })" @after-leave="trigger?.focus({ preventScroll: true })">
    <section v-if="open" role="dialog" aria-modal="true" :aria-labelledby="titleId" class="outreach-screening">
      <header><h3 :id="titleId">通勤试背参考短片</h3><button ref="close" type="button" aria-label="关闭短片" @click="open = false"><YjIcon name="dismiss" size="sm" /></button></header>
      <div class="screening-media"><SamplePlayer :clip="film.result" autoplay /></div>
    </section>
  </NModal>
</template>

<style scoped>
.brief-film { display: block; position: relative; width: 100%; min-width: 0; align-self: center; padding: 0; overflow: hidden; border: 0; border-radius: var(--yj-image-gallery-radius); background: var(--yj-color-on-brand); color: var(--yj-color-on-brand); text-align: start; }
.film-cover { display: block; width: 100%; height: auto; }
.film-caption { position: absolute; right: var(--yj-space-2); bottom: var(--yj-space-2); display: inline-flex; align-items: center; gap: var(--yj-space-1); padding: var(--yj-space-1) var(--yj-space-2); border-radius: var(--yj-radius-sm); background: var(--yj-color-bg-connector-artwork); font-size: var(--yj-font-size-caption); line-height: var(--yj-line-height-caption); font-weight: var(--yj-font-weight-medium); }
.film-caption :deep(svg) { color: inherit; fill: currentColor; }
.film-duration { margin-inline-start: var(--yj-space-1); font-family: var(--yj-font-family-mono); font-variant-numeric: tabular-nums; }
.brief-film:hover .film-caption > span:first-of-type { text-decoration: underline; text-underline-offset: 3px; }
.outreach-screening { width: min(92vw, 430px, 49vh); padding: var(--yj-space-2); border-radius: var(--yj-radius-lg); background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); }
.outreach-screening header { display: flex; align-items: center; justify-content: space-between; gap: var(--yj-space-2); padding: var(--yj-space-1) var(--yj-space-2) var(--yj-space-2); }
.outreach-screening h3 { margin: 0; font-size: var(--yj-font-size-card-title); }
.outreach-screening button { display: grid; place-items: center; width: var(--yj-control-height-sm); height: var(--yj-control-height-sm); border: 0; border-radius: var(--yj-radius-sm); color: var(--yj-color-text-primary); background: transparent; }
.outreach-screening button:hover { background: var(--yj-color-control-hover); }
.brief-film:focus-visible, .outreach-screening button:focus-visible { outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring); outline-offset: 2px; }
.screening-media { width: 100%; aspect-ratio: 9 / 16; overflow: hidden; border-radius: var(--yj-radius-sm); }
</style>
