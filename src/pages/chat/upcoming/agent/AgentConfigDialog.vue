<script setup lang="ts">
import { computed, ref, toRaw } from "vue";
import { NModal } from "naive-ui";
import YjIcon from "../../../../components/yijie/YjIcon.vue";
import AgentMaterials from "./AgentMaterials.vue";
import TargetSettings from "./TargetSettings.vue";
import ImageSettings from "../image-agent/ConfigSettings.vue";
import VideoSettings from "../video-agent/VideoSettings.vue";
import { imageScenes } from "../image-agent/scenes";
import { videoScenes } from "../video-agent/scenes";
import type { ConfigSection, ProductField } from "./config";
import { describeConfig, setDialogDirection, type AgentConfig } from "./presentation";

const props = defineProps<{ config: AgentConfig; section: ConfigSection }>();
const emit = defineEmits<{ close: []; confirm: [value: AgentConfig]; service: [] }>();
// Cancel discards every edit, including replacement images and output settings.
const draft = ref<AgentConfig>(structuredClone(toRaw(props.config)));
const view = computed(() => describeConfig(draft.value));
const isVideo = computed(() => draft.value.kind === "video");
const directions = computed(() => isVideo.value ? Object.values(videoScenes) : Object.values(imageScenes));
const advanced = ref(props.section === "targeting" || props.section === "settings");
const info = ref(false);
const body = ref<HTMLElement>();
const details = ref(false);
const fields: Record<ProductField, string> = { name: "商品名称", core: "核心卖点", brand: "品牌名称", category: "商品类目", sku: "商品货号" };
const basicFields = computed<ProductField[]>(() => isVideo.value ? ["name", "core"] : ["name", "core", "brand"]);
const extraFields = ["brand", "category", "sku"] as const;
const examples = { brand: "例如 Ninja", category: "例如便携式搅拌机", sku: "例如 BC151BK" };
const missing = computed(() => view.value.missing);
const infoStatus = computed(() => {
  const keys = isVideo.value ? [...basicFields.value, ...extraFields] : basicFields.value;
  const count = keys.filter(key => draft.value.product[key]).length;
  if (draft.value.manualFields.length) return `已修改 ${draft.value.manualFields.length} 项`;
  if (draft.value.product.recognized && count) return `已识别 ${count} 项`;
  if (isVideo.value && !draft.value.product.source) return "添加图片后自动识别";
  return draft.value.materials[view.value.primary]?.length ? "已添加本地图片" : "等待商品信息";
});
function markManual(field: ProductField) {
  if (!draft.value.manualFields.includes(field)) draft.value.manualFields.push(field);
}
function revealSection() {
  const target = body.value?.querySelector<HTMLElement>('[data-section="' + props.section + '"]');
  if (body.value && target && body.value.offsetHeight) {
    const bounds = body.value.getBoundingClientRect();
    const scale = bounds.height / body.value.offsetHeight || 1;
    body.value.scrollTop += (target.getBoundingClientRect().top - bounds.top) / scale;
  }
}
function confirm() {
  if (missing.value.length) return;
  draft.value.removed = [];
  emit("confirm", toRaw(draft.value));
}
</script>
<template>
  <NModal show @update:show="!$event && emit('close')" @after-enter="revealSection">
    <section class="agent-config" :class="{ 'agent-config--video': isVideo }" role="dialog" aria-modal="true" aria-labelledby="agent-config-title">
      <header class="agent-config__head"><i><YjIcon :name="isVideo ? 'video' : 'image'" size="md" /></i>
        <div><h2 id="agent-config-title">{{ view.agent }}任务配置</h2><p>先添加商品图片或参考图，其余信息可自动配置</p></div>
        <button type="button" aria-label="关闭任务配置" @click="emit('close')"><YjIcon name="dismiss" size="sm" /></button>
      </header>
      <div ref="body" class="agent-config__body">
        <div data-section="direction">
          <div class="config-heading"><strong><YjIcon name="gridView" size="xs" />内容方向</strong><small>选择后自动调整必填项</small></div>
          <div class="agent-directions"><button v-for="s in directions" :key="s.id" type="button" :aria-pressed="draft.direction === s.id"
            @click="setDialogDirection(draft, s.id)"><YjIcon :name="s.icon" size="xs" />{{ s.label }}</button></div>
        </div>
        <AgentMaterials v-model="draft" data-section="product" @service="emit('service')" />
        <div class="config-info">
          <button type="button" class="config-cover" :aria-expanded="info" @click="info = !info">
            <YjIcon name="skillSourcing" size="sm" /><span><strong>商品信息</strong><small>图片识别后自动填充，可展开修改</small></span>
            <small>{{ infoStatus }}</small><YjIcon name="chevronDown" size="xs" /></button>
          <div v-if="info" class="product-fields">
            <label v-for="key in basicFields" :key="key"><span>{{ fields[key] }} <small>{{ draft.manualFields.includes(key) ? '已修改' : draft.product.recognized && draft.product[key] ? '识别填充' : '待补充' }}</small></span>
              <textarea v-if="key === 'core'" v-model="draft.product.core" rows="2" :aria-label="fields[key]" placeholder="例如无线便携、容量、材质和使用优势" @input="markManual(key)" />
              <input v-else v-model="draft.product[key]" :aria-label="fields[key]" :placeholder="key === 'name' ? '识别后自动填入，也可手动修改' : '识别后自动填入，可选修改'" @input="markManual(key)" />
            </label>
            <template v-if="isVideo">
              <button class="product-more" type="button" :aria-expanded="details" @click="details = !details">更多商品信息 <small>{{ draft.product.brand || draft.product.category || draft.product.sku ? '品牌、类目与货号已识别' : '品牌、类目与货号可选填' }}</small><YjIcon name="chevronDown" size="xs" /></button>
              <div v-if="details" class="product-details"><label v-for="key in extraFields" :key="key"><span>{{ fields[key] }} <small>{{ draft.manualFields.includes(key) ? '已修改' : draft.product[key] ? '识别填充' : '待补充' }}</small></span>
                <input v-model="draft.product[key]" :aria-label="fields[key]" :placeholder="examples[key]" @input="markManual(key)" /></label></div>
            </template>
          </div>
        </div>
        <div class="config-auto" data-section="targeting">
          <div class="config-cover"><YjIcon name="skillBrandMood" size="sm" /><span><strong>自动配置</strong>
            <span class="config-tags"><small v-for="v in [draft.platform,draft.market,draft.language,...view.settingsLabel.split(' · ')]" :key="v">{{ v }}</small></span>
          </span><button type="button" :aria-expanded="advanced" @click="advanced = !advanced"><YjIcon name="skillProductAttributes" size="xs" />{{ advanced ? '收起' : '调整' }}</button></div>
          <div v-if="advanced" data-section="settings"><TargetSettings v-model="draft" />
            <VideoSettings v-if="draft.kind === 'video'" v-model="draft" /><ImageSettings v-else v-model="draft" />
          </div>
        </div>
      </div>
      <footer><span role="status">{{ missing.length ? '请至少添加 1 张' + missing.map(slot => slot === '爆款参考图' ? '参考图' : slot).join('和') + '。' : '生成条件已满足' }}</span>
        <button type="button" :disabled="!!missing.length" @click="confirm">确认并回填 <YjIcon name="arrowRight" size="sm" /></button></footer>
    </section>
  </NModal>
</template>
<style scoped>
.agent-config { display: grid; grid-template-rows: auto minmax(0,1fr) auto; width: min(620px, calc(100% - 24px)); max-height: min(760px,calc(var(--yj-ui-viewport-height, 100vh) - 32px)); overflow: hidden; border: 1px solid var(--agent-line); border-radius: 14px; background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); font-size: 12px; box-shadow: var(--yj-shadow-modal); }
.agent-config :deep(button), .agent-config :deep(select), .agent-config :deep(input:not([type=checkbox],[type=file])), .agent-config :deep(textarea) { border: 1px solid var(--agent-line); border-radius: 5px; padding: 5px 7px; background: var(--yj-color-bg-card); color: var(--yj-color-text-primary); font: inherit; }
.agent-config :deep(button:enabled:hover), .agent-config :deep(.source-action:hover) { background: var(--agent-tint); }
.agent-config :deep(button[aria-pressed=true]) { border-color: var(--agent-ink); background: var(--agent-tint-strong); color: var(--agent-ink); font-weight: 600; }
.agent-config :deep(button:disabled) { opacity: .5; cursor: not-allowed; }
.agent-config__head, .agent-config footer { display: flex; align-items: center; gap: 10px; padding: 12px 20px; }
.agent-config__head { min-height: 70px; border-bottom: 1px solid var(--agent-line); }
.agent-config__head i { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--agent-line); border-radius: 9px; background: var(--agent-tint); }
.agent-config__head i :deep(svg), .config-cover > :deep(svg) { color: var(--agent-ink); }
.agent-config h2 { margin: 0; font-size: 18px; line-height: 24px; }
.agent-config__head p { margin: 3px 0 0; color: var(--yj-color-text-tertiary); }
.agent-config__head button { margin-left: auto; width: 32px; height: 32px; border: 0; }
.agent-config__body { display: grid; grid-auto-rows: max-content; align-content: start; gap: 10px; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px 14px; }
.config-heading, .config-cover, .config-heading strong, .agent-directions button, .config-cover button { display: flex; align-items: center; gap: 6px; }
.config-heading { justify-content: space-between; margin-bottom: 7px; }
.agent-config small { font-size: 10px; color: var(--yj-color-text-tertiary); }
.agent-directions { display: grid; grid-template-columns: repeat(6,minmax(0,1fr)); gap: 4px; }
.agent-directions button { min-height: 36px; padding: 4px 2px; justify-content: center; gap: 3px; font-size: 11px; }
.agent-config--video .agent-directions { display: flex; flex-wrap: wrap; gap: 6px; }
.agent-config--video .agent-directions button { min-width: 88px; padding-inline: 8px; }
.product-more { display: flex; align-items: center; justify-content: space-between; gap: 6px; text-align: left; }
.product-more small { margin-inline-start: auto; }
.product-details { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 6px; }
.product-details input { min-width: 0; width: 100%; }
.config-info, .config-auto { border: 1px solid var(--agent-line); border-radius: 8px; overflow: hidden; }
.agent-config .config-cover { width: 100%; gap: 10px; padding: 9px 10px; border: 0; border-radius: 0; text-align: left; background: var(--agent-tint); }
.config-cover > span { flex: 1; }
.config-cover strong, .config-cover span > small { display: block; }
.config-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.config-tags small { border: 1px solid var(--agent-line); border-radius: 15px; padding: 1px 6px; background: var(--yj-color-bg-card); }
.product-fields { display: grid; gap: 7px; padding: 10px; }
.product-fields label { display: grid; gap: 4px; }
.product-fields label small { margin-left: 4px; }
.agent-config footer { min-height: 62px; justify-content: space-between; border-top: 1px solid var(--agent-line); }
.agent-config footer span { color: var(--agent-ink); font-size: 11px; }
.agent-config footer button { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 6px 18px; border: 0; background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); font-weight: 600; }
.agent-config footer button:hover:enabled { background: var(--yj-color-brand-hover); }
.agent-config footer :deep(svg) { color: inherit; }
@media(max-width:620px) { .agent-directions { grid-template-columns: repeat(3,minmax(0,1fr)); } .product-details { grid-template-columns: minmax(0,1fr); } }
</style>
