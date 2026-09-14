<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NCard, NInput, NModal, type InputInst } from "naive-ui";
import type { WorkflowSchemas } from "../../api/workflow-native-client";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  show: boolean; busy: boolean; uncertain: boolean; queryable: boolean;
  created: boolean; available: boolean; error?: string;
}>();
const emit = defineEmits<{
  cancel: []; closed: []; confirm: [input: WorkflowSchemas["CreateInput"]]; query: []; enter: [];
}>();
const nameInput = ref<InputInst | null>(null);
const name = ref("");
const description = ref("");
const nameTouched = ref(false);
const descriptionTouched = ref(false);
const count = (text: string) => Array.from(text).length;
const nameError = computed(() => !name.value.trim() ? "请输入工作流名称" : count(name.value.trim()) > 30 ? "工作流名称不能超过 30 个字，支持中文" : "");
const descriptionError = computed(() => !description.value.trim() ? "请输入工作流描述" : count(description.value.trim()) > 600 ? "工作流描述不能超过 600 个字" : "");
const locked = computed(() => props.busy || props.uncertain || props.created);
const valid = computed(() => !nameError.value && !descriptionError.value);
watch(() => props.show, show => {
  if (show) { name.value = ""; description.value = ""; nameTouched.value = false; descriptionTouched.value = false; }
});
function cancel() { if (!props.busy && !props.uncertain) emit("cancel"); }
function submit() {
  nameTouched.value = true; descriptionTouched.value = true;
  if (valid.value && !locked.value && props.available) emit("confirm", { name: name.value.trim(), description: description.value.trim() });
}
</script>

<template>
  <NModal :show="show" :mask-closable="false" :close-on-esc="!busy && !uncertain" @esc="cancel" @after-enter="nameInput?.focus()" @after-leave="emit('closed')">
    <NCard :bordered="false" role="dialog" aria-modal="true" aria-labelledby="workflow-create-title" class="workflow-create-dialog">
    <div class="workflow-create-dialog__header">
      <h2 id="workflow-create-title">创建工作流</h2>
      <NButton quaternary circle aria-label="关闭创建工作流" :disabled="busy || uncertain" @click="cancel"><YjIcon name="dismiss" size="sm" /></NButton>
    </div>
    <form class="workflow-create-dialog__form" :aria-busy="busy" @submit.prevent="submit">
      <div class="workflow-create-dialog__symbol" aria-hidden="true"><YjIcon name="workflow" size="lg" /></div>
      <div class="workflow-create-dialog__field">
        <label for="workflow-create-name">工作流名称 <span class="workflow-create-dialog__required" aria-hidden="true">*</span></label>
        <NInput ref="nameInput" v-model:value="name" placeholder="请输入工作流名称" :disabled="locked" :status="nameTouched && nameError ? 'error' : undefined"
          :input-props="{ id: 'workflow-create-name', 'aria-required': 'true', 'aria-invalid': nameTouched && !!nameError, 'aria-describedby': 'workflow-create-name-hint' }"
          @blur="nameTouched = true">
          <template #suffix><span class="workflow-create-dialog__count">{{ count(name) }}/30</span></template>
        </NInput>
        <p id="workflow-create-name-hint" :class="{ 'workflow-create-dialog__error': nameTouched && nameError }" :role="nameTouched && nameError ? 'alert' : undefined">{{ nameTouched && nameError ? nameError : '支持中文，最多 30 个字' }}</p>
      </div>
      <div class="workflow-create-dialog__field">
        <label for="workflow-create-description">工作流描述 <span class="workflow-create-dialog__required" aria-hidden="true">*</span></label>
        <NInput v-model:value="description" type="textarea" placeholder="请描述这个工作流的用途与使用场景" :disabled="locked"
          :autosize="{ minRows: 5, maxRows: 7 }" :status="descriptionTouched && descriptionError ? 'error' : undefined"
          :input-props="{ id: 'workflow-create-description', 'aria-required': 'true', 'aria-invalid': descriptionTouched && !!descriptionError, 'aria-describedby': 'workflow-create-description-hint workflow-create-description-count' }"
          @blur="descriptionTouched = true" />
        <div class="workflow-create-dialog__description-hint">
          <p id="workflow-create-description-hint" :class="{ 'workflow-create-dialog__error': descriptionTouched && descriptionError }" :role="descriptionTouched && descriptionError ? 'alert' : undefined">{{ descriptionTouched && descriptionError ? descriptionError : '描述会展示在“我的工作流”卡片中' }}</p>
          <span id="workflow-create-description-count" class="workflow-create-dialog__count">{{ count(description) }}/600</span>
        </div>
      </div>
      <p v-if="!available" role="status">工作流服务尚未启用，请通过本地工作流入口启动应用。</p>
      <p v-if="error" class="workflow-create-dialog__error" role="alert">{{ error }}</p>
      <p v-if="busy" role="status">正在确认创建结果…</p>
      <p v-if="uncertain" role="status">{{ queryable ? '创建结果尚未确认，请查询原操作后继续，避免重复创建。' : '创建结果尚未确认，尚未取得可查询的操作标识，请保留此页面。' }}</p>
      <div class="workflow-create-dialog__actions">
        <NButton :disabled="busy || uncertain" @click="cancel">取消</NButton>
        <NButton v-if="uncertain && queryable" type="primary" :disabled="busy" @click="emit('query')">查询创建结果</NButton>
        <NButton v-else-if="created" type="primary" @click="emit('enter')">进入工作流</NButton>
        <NButton v-else attr-type="submit" type="primary" :loading="busy" :disabled="!valid || uncertain || !available">{{ busy ? '创建中…' : '确认' }}</NButton>
      </div>
    </form>
    </NCard>
  </NModal>
</template>

<style>
.workflow-create-dialog { width: min(var(--yj-layout-workflow-create-width), calc(100vw - var(--yj-space-8))); max-height: calc(100vh - var(--yj-space-8)); overflow: auto; }
</style>
<style scoped>
.workflow-create-dialog__header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--yj-space-4); }
.workflow-create-dialog__header h2 { margin: 0; font-size: var(--yj-font-size-section-title); font-weight: var(--yj-font-weight-semibold); }
.workflow-create-dialog__form { display: grid; gap: var(--yj-space-5); }
.workflow-create-dialog__symbol { justify-self: center; display: grid; place-items: center; width: var(--yj-space-16); height: var(--yj-space-16); border-radius: var(--yj-radius-xl); background: var(--yj-color-brand-primary); color: var(--yj-color-on-brand); margin-block: var(--yj-space-2); }
.workflow-create-dialog__symbol :deep(.yj-icon) { color: inherit; }
.workflow-create-dialog__field { display: grid; gap: var(--yj-space-2); min-width: 0; }
.workflow-create-dialog__field label { font-weight: var(--yj-font-weight-semibold); color: var(--yj-color-text-primary); }
.workflow-create-dialog__field p { margin: 0; font-size: var(--yj-font-size-caption); color: var(--yj-color-text-secondary); }
.workflow-create-dialog__description-hint { display: flex; justify-content: space-between; gap: var(--yj-space-3); }
.workflow-create-dialog__count { white-space: nowrap; color: var(--yj-color-text-secondary); font-size: var(--yj-font-size-caption); }
.workflow-create-dialog__required, .workflow-create-dialog__error, .workflow-create-dialog__field p.workflow-create-dialog__error { color: var(--yj-color-semantic-error-ink); }
.workflow-create-dialog__actions { display: flex; justify-content: flex-end; gap: var(--yj-space-3); padding-top: var(--yj-space-3); }
</style>
