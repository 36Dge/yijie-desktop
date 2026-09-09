<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from "vue";
import YjLogo from "../yijie/YjLogo.vue";
import {
  HOME_OPENING_DURATION, HOME_OPENING_END, HOME_OPENING_SETTLE,
  mix, openingPose, projectOpening, readOpeningPlanes, settleOpening,
} from "./home-opening-geometry";

const props=withDefaults(defineProps<{ skipAnimation?: boolean }>(), { skipAnimation:false });
const root=ref<HTMLElement|null>(null);
const logo=ref<HTMLElement|null>(null);
const stage=ref<SVGSVGElement|null>(null);
const active=ref(false);
const pose=shallowRef(HOME_OPENING_END);
const target=ref({ x:107, y:68 });
const sizes=ref({ peak:80, rest:32 });
const id=useId();
let planes: ReturnType<typeof readOpeningPlanes> = [];
let frame: number|null=null;
let observer: ResizeObserver|null=null;
let preference: MediaQueryList|null=null;
let duration=HOME_OPENING_DURATION;
let settleDuration=HOME_OPENING_SETTLE;
let disposed=false;
const faces=computed(()=>active.value ? projectOpening(planes,pose.value,target.value,sizes.value) : []);
const titleStyle=computed(()=>active.value ? {
  transform:`translateX(${mix(-36,0,pose.value.identity)}px)`,
  clipPath:`inset(0 ${mix(100,0,pose.value.identity)}% 0 0)`,
  opacity:pose.value.identity>0 ? 1 : 0,
} : undefined);
const subtitleStyle=computed(()=>active.value ? {
  transform:`translateY(${mix(20,0,pose.value.copy)}px)`, opacity:pose.value.copy,
} : undefined);

function cancelFrame(): void {
  if(frame!==null) cancelAnimationFrame(frame);
  frame=null;
}
function rest(): void { cancelFrame(); active.value=false; pose.value=HOME_OPENING_END; }
function measure(): void {
  if(!root.value || !stage.value || !logo.value) return;
  const style=getComputedStyle(root.value);
  const token=(name: string, fallback: number): number => {
    const value=Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && value>0 ? value : fallback;
  };
  const timeToken=(name: string, fallback: number): number => {
    // The production CSS minifier converts 2200ms to 2.2s (and 160ms to .16s).
    const match=style.getPropertyValue(name).trim().match(/^(\d*\.?\d+)(ms|s)$/);
    if(!match) return fallback;
    const value=Number(match[1])*(match[2]==="s" ? 1000 : 1);
    return Number.isFinite(value) && value>0 ? value : fallback;
  };
  duration=timeToken("--yj-motion-home-opening",HOME_OPENING_DURATION);
  settleDuration=timeToken("--yj-motion-home-opening-settle",HOME_OPENING_SETTLE);
  sizes.value={ peak:token("--yj-home-opening-logo-peak",80), rest:token("--yj-logo-mark-md",32) };
  const matrix=stage.value.getScreenCTM?.();
  if(matrix) {
    const rect=logo.value.getBoundingClientRect();
    const x=rect.left+rect.width/2, y=rect.top+rect.height/2;
    const inverse=matrix.inverse();
    const result={ x:inverse.a*x+inverse.c*y+inverse.e, y:inverse.b*x+inverse.d*y+inverse.f };
    if(Number.isFinite(result.x) && Number.isFinite(result.y)) target.value={ x:result.x,y:result.y };
  }
}
function finish(): void {
  if(!active.value) return;
  cancelFrame();
  if(preference?.matches || document.hidden) {rest();return;}
  const from=pose.value;
  const start=performance.now();
  const tick=(now: number): void => {
    if(disposed) return;
    const progress=Math.min(1,(now-start)/settleDuration);
    pose.value=settleOpening(from,progress);
    if(progress<1) frame=requestAnimationFrame(tick); else rest();
  };
  frame=requestAnimationFrame(tick);
}
function hidden(): void { if(document.hidden) rest(); }
function reduced(): void { if(preference?.matches) rest(); }
watch(()=>props.skipAnimation, value=>{if(value) finish();});

onMounted(()=>{
  preference=window.matchMedia("(prefers-reduced-motion: reduce)");
  // The homepage mounts on entry; selecting its already active menu does not remount it.
  if(props.skipAnimation || preference.matches || document.hidden) return;
  try {planes=readOpeningPlanes();} catch {return;}
  measure();
  observer=new ResizeObserver(measure);
  observer.observe(root.value!);
  preference.addEventListener("change",reduced);
  document.addEventListener("visibilitychange",hidden);
  active.value=true;
  pose.value=openingPose(0);
  const start=performance.now();
  const tick=(now: number): void=>{
    if(disposed) return;
    const progress=Math.min(1,(now-start)/duration);
    pose.value=openingPose(progress);
    if(progress<1) frame=requestAnimationFrame(tick); else rest();
  };
  frame=requestAnimationFrame(tick);
});
onBeforeUnmount(()=>{
  disposed=true;
  cancelFrame();
  observer?.disconnect();
  preference?.removeEventListener("change",reduced);
  document.removeEventListener("visibilitychange",hidden);
});
defineExpose({finish});
</script>

<template>
  <div ref="root" class="home-opening" :data-animating="active">
    <div class="home-opening__brand">
      <span ref="logo" class="home-opening__logo" :class="{ 'is-hidden':active }" aria-hidden="true"><YjLogo variant="mark" size="md" /></span>
      <div class="home-opening__title-clip"><h1 id="new-task-title" class="home-opening__title" :style="titleStyle">易界AI</h1></div>
    </div>
    <div class="home-opening__subtitle-clip"><p id="new-task-subtitle" class="home-opening__subtitle" :style="subtitleStyle">让跨境生意，更进一步。</p></div>
    <svg ref="stage" class="home-opening__stage" :class="{ 'is-hidden':!active }" viewBox="0 0 320 136" aria-hidden="true" focusable="false" shape-rendering="geometricPrecision">
      <defs>
        <linearGradient :id="`${id}-shade`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--yj-home-opening-shade)" stop-opacity="0" /><stop offset="1" stop-color="var(--yj-home-opening-shade)" /></linearGradient>
        <linearGradient :id="`${id}-light`" :x1="`${mix(100,-100,pose.lightPosition)}%`" y1="0" :x2="`${mix(260,60,pose.lightPosition)}%`" y2="15%"><stop offset=".2" stop-color="var(--yj-home-opening-light)" stop-opacity="0" /><stop offset=".46" stop-color="var(--yj-home-opening-light)" /><stop offset=".68" stop-color="var(--yj-home-opening-light)" stop-opacity="0" /></linearGradient>
        <filter :id="`${id}-shadow`" x="-50%" y="-200%" width="200%" height="500%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      <ellipse cx="160" :cy="116-mix(0,5,pose.unfold)" :rx="42*mix(.55,1.1,pose.unfold)" :ry="4*mix(.6,1,pose.unfold)" fill="var(--yj-home-opening-shadow)" :filter="`url(#${id}-shadow)`" :opacity="pose.reveal*(1-pose.land)*.6" />
      <g v-for="face in faces" :key="face.name" :class="['home-opening__plane',`home-opening__plane--${face.name}`]" :opacity="pose.reveal">
        <path class="home-opening__edge" :d="face.edge" :opacity="pose.thickness" />
        <path class="home-opening__face" :d="face.front" />
        <path :d="face.front" :fill="`url(#${id}-shade)`" :opacity=".7*(1-pose.face)" />
        <path :d="face.front" :fill="`url(#${id}-light)`" :opacity="pose.light*(face.name==='fold' ? .45 : .6)" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.home-opening { position:relative; width:100%; margin-bottom:var(--yj-space-8); }
.home-opening__brand { display:flex; align-items:center; justify-content:center; gap:var(--yj-space-3); min-height:var(--yj-line-height-display); }
.home-opening__logo { display:flex; flex:none; width:var(--yj-logo-mark-md); height:var(--yj-logo-mark-md); }
.home-opening__title-clip { overflow:hidden; }
.home-opening__title { margin:0; color:var(--yj-color-text-primary); font-size:var(--yj-font-size-display); line-height:var(--yj-line-height-display); font-weight:var(--yj-font-weight-semibold); }
.home-opening__subtitle-clip { overflow:hidden; margin-top:var(--yj-space-3); }
.home-opening__subtitle { margin:0; text-align:center; color:var(--yj-color-text-body); font-size:var(--yj-font-size-body); line-height:var(--yj-line-height-body); }
.home-opening__stage { position:absolute; top:calc(-1 * var(--yj-space-12)); left:calc(50% - var(--yj-home-opening-stage-width) / 2); width:var(--yj-home-opening-stage-width); height:var(--yj-home-opening-stage-height); overflow:visible; pointer-events:none; }
.is-hidden { visibility:hidden; }
.home-opening__face { fill:var(--yj-home-opening-face); }
.home-opening__edge { fill:var(--yj-home-opening-edge); }
.home-opening__plane--fold .home-opening__face { fill:var(--yj-color-brand-primary); }
.home-opening__plane--fold .home-opening__edge { fill:var(--yj-home-opening-fold-edge); }
@media (prefers-reduced-motion:reduce) {
  .home-opening__stage { visibility:hidden; }
  .home-opening__logo { visibility:visible; }
  .home-opening__title,.home-opening__subtitle { transform:none !important; clip-path:none !important; opacity:1 !important; }
}
</style>
