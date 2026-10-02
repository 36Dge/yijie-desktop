<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { NPopover } from "naive-ui";
import type { Catalog, ProfileId } from "../../api/chat-model-client";
import YjIcon from "../yijie/YjIcon.vue";
const props=defineProps<{catalog:Catalog|null;profile:ProfileId|null;disabled:boolean;disabledReason?:string;loading:boolean;saving:boolean;error:string}>();
const emit=defineEmits<{select:[id:ProfileId];retry:[]}>();
const overlay=ref<HTMLElement|null>(null);
const open=ref(false),trigger=ref<HTMLButtonElement|null>(null),menu=ref<HTMLElement|null>(null);
const label=computed(()=>props.saving?"正在切换模型…":props.loading?"模型加载中":props.catalog?.models.find(m=>m.profile.profile_id===props.profile)?.profile.label??(props.profile==="kimi-k3-max-v1"?"Kimi K3":"模型待识别"));
const unavailable=computed(()=>props.catalog?.models.find(m=>m.profile.profile_id===props.profile)?.available===false);
watch(()=>props.disabled||props.saving,v=>{if(v)open.value=false;});
watch(open,async v=>{await nextTick();if(v)(menu.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)')??menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({preventScroll:true});else if(!props.disabled)trigger.value?.focus({preventScroll:true});});
function choose(id:ProfileId){if(props.disabled||props.saving)return;open.value=false;emit("select",id);}
function key(event:KeyboardEvent){event.stopPropagation();if(event.key==="Escape"){open.value=false;return;}
 if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;event.preventDefault();
 const items=[...menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)')??[]];const index=items.indexOf(document.activeElement as HTMLButtonElement);
 const next=event.key==="Home"?0:event.key==="End"?items.length-1:(index+(event.key==="ArrowUp"?-1:1)+items.length)%items.length;items[next]?.focus({preventScroll:true});
}
</script>
<template>
 <Teleport to="body"><div ref="overlay" class="model-overlay" /></Teleport>
 <NPopover :to="overlay ?? false" v-model:show="open" trigger="click" placement="top-end" :show-arrow="false" :disabled="disabled || loading || saving" raw>
  <template #trigger><button ref="trigger" class="model-trigger yj-control yj-control--compact" type="button" :disabled="disabled || loading || saving" :aria-label="`选择对话模型，当前 ${label}`" :aria-expanded="open" aria-haspopup="menu" :title="disabled ? (disabledReason ?? '当前任务结束后可切换模型') : unavailable ? '模型未配置，请选择可用模型' : label" @keydown.stop><span>{{ label }}</span><YjIcon name="chevronDown" size="xs" tone="muted" /></button></template>
  <div ref="menu" class="model-menu" role="menu" aria-label="对话模型" @keydown="key">
   <button v-for="entry in catalog?.models ?? []" :key="entry.profile.profile_id" type="button" role="menuitemradio" :aria-checked="entry.profile.profile_id === profile" :disabled="!entry.available" @click="choose(entry.profile.profile_id)">
    <span><strong>{{ entry.profile.label }}</strong><small>{{ !entry.available ? '模型未配置' : entry.profile.effort === 'max' ? '推理强度：max' : '现有对话模型' }}</small></span><YjIcon v-if="entry.profile.profile_id === profile" name="check" size="sm" />
   </button>
   <span v-if="!catalog?.models.length">暂无可用模型</span>
  </div>
 </NPopover>
 <button v-if="error" class="model-retry yj-control" type="button" :disabled="saving || disabled" :title="error" aria-label="重试模型操作" @click="emit('retry')">重试</button>
 <span class="sr-only" role="status">{{ error || (unavailable ? '模型未配置' : '') }}</span>
</template>
<style scoped>
.model-trigger{display:inline-flex;align-items:center;gap:var(--yj-space-1);border:0;background:transparent;color:var(--yj-color-text-primary);white-space:nowrap;cursor:pointer;}
.model-trigger:hover:not(:disabled){background:var(--yj-color-control-hover);}
.model-trigger:disabled{color:var(--yj-color-text-disabled);cursor:default;}
.model-overlay{position:fixed;inset:0;pointer-events:none;zoom:calc(1 / var(--yj-ui-scale, 1));z-index:var(--yj-z-popover);}
.model-menu{pointer-events:auto;zoom:var(--yj-ui-scale, 1);width:min(var(--yj-layout-permission-menu-width),calc(var(--yj-ui-viewport-width,100vw) - var(--yj-space-10)));padding:var(--yj-space-1);border:var(--yj-border-width) solid var(--yj-color-border-default);border-radius:var(--yj-radius-lg);background:var(--yj-color-bg-elevated);box-shadow:var(--yj-shadow-popover);}
.model-menu button{display:flex;align-items:center;justify-content:space-between;width:100%;padding:var(--yj-space-3);border:0;border-radius:var(--yj-radius-md);background:transparent;color:var(--yj-color-text-primary);text-align:left;cursor:pointer;}
.model-menu button:hover:not(:disabled){background:var(--yj-color-control-hover);}
.model-menu button:disabled{color:var(--yj-color-text-disabled);cursor:default;}
.model-menu small{display:block;color:var(--yj-color-text-secondary);margin-top:var(--yj-space-1);}
.model-retry{color:var(--yj-color-semantic-warning-ink);}
</style>
