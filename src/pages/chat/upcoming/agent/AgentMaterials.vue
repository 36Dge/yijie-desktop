<script setup lang="ts">
import { computed } from "vue";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import MaterialImage from "./MaterialImage.vue";
import { chooseLibraryProduct, describeConfig, type AgentConfig } from "./presentation";
import type { MaterialSlot } from "./config";

const draft = defineModel<AgentConfig>({ required: true });
const emit = defineEmits<{ service: [] }>();
const sources = ["链接", "商品库", "文档", "上传图片"] as const;
const view = computed(() => describeConfig(draft.value));
const product = computed(() => draft.value.materials[view.value.primary] ?? []);
const video = computed(() => draft.value.kind === "video");
function thumbnail(slot: MaterialSlot) {
  const item = draft.value.materials[slot]?.[0];
  return slot === "参考视频" ? item?.poster : item?.src;
}
function upload(slot: MaterialSlot, event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []).filter(file => file.type.startsWith(slot === "参考视频" ? "video/" : "image/"));
  input.value = "";
  if (!files.length) return;
  draft.value.materials[slot] = files.map(file => ({ name: file.name, src: file }));
  if (slot === view.value.primary) {
    draft.value.product.source = "本地图片";
    draft.value.product.recognized = 0;
    if (!draft.value.manualFields.includes("name")) draft.value.product.name = files[0]!.name;
    for (const field of ["brand", "core", "category", "sku"] as const) if (!draft.value.manualFields.includes(field)) draft.value.product[field] = "";
  }
}
</script>
<template>
  <section class="agent-materials" :aria-label="video ? '视频素材' : '图片素材'">
    <header><strong><YjIcon name="image" size="xs" />{{ video ? '视频素材' : '图片素材' }}</strong><small>{{ view.required.length - view.missing.length }}/{{ view.required.length }} 已完成</small></header>
    <div v-for="slot in view.required" :key="slot" class="agent-materials__row">
      <div class="agent-materials__role"><YjIcon :name="draft.materials[slot]?.length ? 'checkmark' : 'image'" size="sm" />
        <div><strong>{{ slot === '爆款参考图' ? '参考图' : slot }} <em>必填</em></strong>
          <p>{{ slot === view.primary ? '可从链接、商品库、文档识别，或直接上传图片' : '用于复刻构图、布局和视觉节奏' }}</p></div>
      </div>
      <template v-if="slot === view.primary">
        <div v-if="product.length && draft.product.source" class="agent-materials__result">
          <MaterialImage :source="product[0]!.src" :alt="view.primary + '预览'" /><div><small>{{ draft.product.source }}</small>
            <strong>{{ draft.product.name }}</strong><p>{{ view.primary }} {{ product.length }} 张<span v-if="draft.product.recognized"> · 已识别 {{ draft.product.recognized }} 项信息</span></p></div>
          <button type="button" aria-label="重新选择图片来源" @click="draft.materials[view.primary] = []"><YjIcon name="rerun" size="xs" /></button>
        </div>
        <div v-else class="agent-materials__sources">
          <div class="source-tabs"><button v-for="choice in sources" :key="choice" type="button" :aria-pressed="draft.productSource === choice" @click="draft.productSource = choice">{{ choice }}</button></div>
          <div v-if="draft.productSource === '链接'" class="source-link"><input v-model="draft.productLink" aria-label="商品链接" placeholder="粘贴商品链接" /><button type="button" @click="emit('service')">识别</button></div>
          <button v-else-if="draft.productSource === '商品库'" type="button" class="source-action" @click="chooseLibraryProduct(draft)">选择 Ninja Blast Blender <YjIcon name="chevronRight" size="xs" /></button>
          <button v-else-if="draft.productSource === '文档'" type="button" class="source-action" @click="emit('service')">上传商品文档 <YjIcon name="plus" size="xs" /></button>
          <label v-else class="source-action">上传一张或多张图片 <YjIcon name="plus" size="xs" /><input type="file" accept="image/*" multiple :aria-label="'上传' + view.primary" @change="upload(view.primary, $event)" /></label>
        </div>
      </template>
      <div v-else class="agent-materials__result">
        <MaterialImage v-if="draft.materials[slot]?.[0]" :source="draft.materials[slot]![0]!.src" alt="参考图预览" />
        <label class="source-action">{{ draft.materials[slot]?.[0]?.name ?? '上传参考图' }}
          <input type="file" accept="image/*" multiple aria-label="选择参考图" @change="upload(slot, $event)" /></label>
        <button v-if="draft.materials[slot]?.length" type="button" aria-label="删除参考图" @click="draft.materials[slot] = []"><YjIcon name="dismiss" size="xs" /></button>
      </div>
    </div>
    <template v-if="view.optional.length">
      <header class="agent-materials__optional"><div><strong><YjIcon name="workflowBatchImages" size="xs" />{{ video ? '参考素材' : '辅助参考图' }}</strong><p>{{ video ? '选填 · 直接补充场景、模特或风格依据' : '选填 · 补充场景、模特或风格参考' }}</p></div><span>{{ view.optional.length }} 类可选</span></header>
      <div class="agent-materials__slots">
        <div v-for="slot in view.optional" :key="slot" class="material-slot">
          <label>
            <MaterialImage v-if="thumbnail(slot)" :source="thumbnail(slot)!" :alt="slot + '预览'" /><YjIcon v-else :name="slot === '参考视频' ? 'clapperboard' : 'image'" size="sm" />
            <span><strong>{{ slot }}</strong><small>{{ draft.materials[slot]?.length ? '已添加 ' + draft.materials[slot]!.length + ' 项 · 点击替换' : '建议上传' }}</small></span>
            <YjIcon v-if="!draft.materials[slot]?.length" name="plus" size="xs" />
            <input type="file" :accept="slot === '参考视频' ? 'video/*' : 'image/*'" multiple :aria-label="'选择' + slot" @change="upload(slot, $event)" />
          </label>
          <button v-if="draft.materials[slot]?.length" type="button" :aria-label="'删除' + slot" @click="draft.materials[slot] = []"><YjIcon name="dismiss" size="xs" /></button>
        </div>
      </div>
    </template>
  </section>
</template>
<style scoped>
.agent-materials { border: 1px solid var(--agent-line); border-radius: 9px; overflow: hidden; }
.agent-materials header, .agent-materials__role, .agent-materials strong:has(> svg), .source-action, .material-slot label, .source-link { display: flex; align-items: center; gap: 7px; }
.agent-materials header { justify-content: space-between; padding: 9px 11px; }
.agent-materials header > small { border-radius: 20px; padding: 3px 8px; color: var(--yj-color-semantic-success-ink); background: var(--yj-color-success-soft); }
.agent-materials__row { display: grid; grid-template-columns: minmax(0,.96fr) minmax(0,1.04fr); align-items: center; gap: 10px; border-top: 1px solid var(--agent-line); padding: 10px 12px; }
.agent-materials__role > svg, .material-slot label > svg:first-child { box-sizing: content-box; padding: 6px; border-radius: 5px; background: var(--agent-tint); color: var(--agent-ink); }
.agent-materials em { color: var(--yj-color-semantic-error-ink); font-size: 10px; font-style: normal; }
.agent-materials p, .agent-materials small, .agent-materials__optional > span { margin: 2px 0 0; font-size: 10px; line-height: 15px; color: var(--yj-color-text-tertiary); }
.agent-materials__result { display: flex; align-items: center; gap: 7px; padding: 6px; min-height: 62px; border: 1px solid var(--agent-line); border-radius: 6px; background: var(--agent-tint); }
.agent-materials__result img { width: 46px; height: 46px; object-fit: cover; border-radius: 4px; }
.agent-materials__result div { flex: 1; min-width: 0; }
.agent-materials__result strong, .material-slot strong, .material-slot small { display: block; }
.agent-materials__result strong { font-size: 12px; overflow-wrap: anywhere; }
.agent-materials__result button, .material-slot > button { display: grid; place-items: center; flex: none; width: 26px; height: 26px; padding: 0; }
.agent-materials__optional { border-block: 1px solid var(--agent-line); background: var(--agent-tint); }
.agent-materials__slots { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; padding: 9px 10px; }
.material-slot { position: relative; display: flex; align-items: center; padding: 6px; min-width: 0; border: 1px solid var(--agent-line); border-radius: 6px; }
.material-slot label { min-width: 0; min-height: 42px; flex: 1; cursor: pointer; font-size: 11px; }
.material-slot label > svg:last-of-type { margin-inline-start: auto; }
.material-slot img { width: 34px; height: 34px; border-radius: 4px; object-fit: cover; }
.source-tabs { display: flex; gap: 3px; flex-wrap: wrap; margin-bottom: 6px; }
.source-tabs button { flex: auto; font-size: 10px; padding: 4px; }
.source-link input { min-width: 0; width: 100%; }
.source-action { justify-content: space-between; width: 100%; min-height: 32px; padding: 4px 7px; cursor: pointer; position: relative; }
.agent-materials label:has(input[type="file"]):focus-within { outline: 2px solid var(--yj-color-focus-ring); }
.agent-materials input[type=file] { position: absolute; width: 1px; height: 1px; opacity: 0; }
@media(max-width:650px) { .agent-materials__row { grid-template-columns: 1fr; } .agent-materials__slots { grid-template-columns: repeat(2,minmax(0,1fr)); } }
</style>
