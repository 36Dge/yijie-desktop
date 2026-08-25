<script setup lang="ts">
import { computed, useId } from "vue";
import { NButton, NSwitch, NTag, NTooltip } from "naive-ui";
import {
  skillCanInstall,
  skillCapabilitySummary,
  skillFailureMessage,
  skillRiskLabel,
  skillSourceLabel,
  type ManagedSkillProjection,
} from "../../domain/skill-marketplace";
import { isYjIconName, type YjIconName } from "../../icons/registry";
import type { SkillOperationKind } from "../../stores/skill.store";
import YjIcon from "../yijie/YjIcon.vue";

const props = defineProps<{
  skill: ManagedSkillProjection;
  canManage: boolean;
  operation?: SkillOperationKind | null;
  operationError?: string | null;
}>();

const emit = defineEmits<{
  install: [skillId: string];
  "enabled-change": [skillId: string, enabled: boolean];
  uninstall: [skillId: string, trigger: HTMLElement];
}>();

const titleId = useId();
const descriptionId = useId();
const iconName = computed<YjIconName>(() =>
  isYjIconName(props.skill.iconKey) ? props.skill.iconKey : "plugin",
);
const installed = computed(() => props.skill.installationStatus === "installed");
const installable = computed(() => props.canManage && skillCanInstall(props.skill));
const capabilitySummary = computed(() => skillCapabilitySummary(props.skill));
const sourceLabel = computed(() => skillSourceLabel(props.skill.sourceType));
const riskLabel = computed(() => skillRiskLabel(props.skill.riskLevel));
const failureMessage = computed(() =>
  props.operationError ?? skillFailureMessage(props.skill.failureCode),
);
const pending = computed(() => props.operation !== null && props.operation !== undefined);
const enabledLabel = computed(() =>
  props.skill.enabled ? `停用 ${props.skill.displayName}` : `启用 ${props.skill.displayName}`,
);
const riskTagType = computed<"default" | "warning" | "error">(() => {
  if (props.skill.riskLevel === "medium") return "warning";
  if (props.skill.riskLevel === "high" || props.skill.riskLevel === "critical") return "error";
  return "default";
});
const status = computed<{
  label: string;
  type: "default" | "success" | "warning" | "error";
}>(() => {
  switch (props.operation) {
    case "install":
      return { label: "正在安装", type: "default" };
    case "enable":
    case "disable":
      return { label: "正在同步", type: "default" };
    case "uninstall":
      return { label: "正在卸载", type: "default" };
  }
  if (props.skill.installationStatus === "error" || failureMessage.value !== null) {
    return { label: "需要处理", type: "error" };
  }
  if (props.skill.installationStatus === "installing") {
    return { label: "正在安装", type: "default" };
  }
  if (props.skill.installationStatus === "uninstalling") {
    return { label: "正在卸载", type: "default" };
  }
  if (props.skill.catalogStatus === "blocked") {
    return { label: "暂不可安装", type: "warning" };
  }
  if (
    props.skill.capabilityReadiness === "blocked" ||
    props.skill.capabilityReadiness === "degraded"
  ) {
    return { label: "能力未就绪", type: "warning" };
  }
  if (props.skill.installationStatus === "unknown") {
    return { label: "状态不兼容", type: "error" };
  }
  if (!installed.value) return { label: "未安装", type: "default" };
  if (!props.skill.enabled) return { label: "已停用", type: "default" };
  if (!props.skill.runtimeVisible) return { label: "正在同步", type: "warning" };
  return { label: "模型可用", type: "success" };
});

function requestUninstall(event: MouseEvent): void {
  emit("uninstall", props.skill.id, event.currentTarget as HTMLElement);
}
</script>

<template>
  <article
    class="skill-card"
    :class="{ 'skill-card--busy': pending }"
    :aria-labelledby="titleId"
    :aria-describedby="descriptionId"
    :aria-busy="pending"
  >
    <div class="skill-card__main">
      <span class="skill-card__icon" aria-hidden="true">
        <YjIcon :name="iconName" size="xl" tone="primary" />
      </span>

      <div class="skill-card__content">
        <div class="skill-card__title-row">
          <h3 :id="titleId" class="skill-card__title">{{ skill.displayName }}</h3>
          <n-tag size="small" :type="status.type" :bordered="false">{{ status.label }}</n-tag>
        </div>
        <p :id="descriptionId" class="skill-card__description">{{ skill.description }}</p>
      </div>

      <div class="skill-card__actions" aria-label="Skill 操作">
        <template v-if="installed">
          <button
            v-if="canManage"
            class="skill-card__delete"
            type="button"
            :disabled="pending"
            :aria-label="`卸载 ${skill.displayName}`"
            title="卸载"
            @click="requestUninstall"
          >
            <YjIcon name="trash" size="lg" />
          </button>
          <n-switch
            :value="skill.enabled"
            :loading="operation === 'enable' || operation === 'disable'"
            :disabled="!canManage || pending"
            :aria-label="enabledLabel"
            @update:value="emit('enabled-change', skill.id, $event)"
          />
        </template>
        <n-tooltip v-else-if="installable" trigger="hover">
          <template #trigger>
            <n-button
              class="skill-card__install"
              quaternary
              circle
              :loading="operation === 'install'"
              :disabled="pending"
              :aria-label="`安装 ${skill.displayName}`"
              @click="emit('install', skill.id)"
            >
              <template #icon><YjIcon name="plus" size="lg" /></template>
            </n-button>
          </template>
          安装
        </n-tooltip>
      </div>
    </div>

    <div class="skill-card__metadata">
      <span>v{{ skill.version }}</span>
      <span>来源：{{ sourceLabel }}</span>
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-tag size="small" :type="riskTagType" :bordered="false" tabindex="0">
            {{ riskLabel }}
          </n-tag>
        </template>
        {{ skill.riskReasons.join('；') }}
      </n-tooltip>
      <span>适用：易界 AI 对话</span>
      <span>{{ capabilitySummary }}</span>
      <span :title="skill.licenseExpression">许可：{{ skill.licenseExpression }}</span>
      <span v-if="skill.maintenanceStatus === 'unmaintained'">不再随客户端维护</span>
    </div>

    <p v-if="failureMessage" class="skill-card__error" role="alert">
      {{ failureMessage }}
    </p>
  </article>
</template>

<style scoped>
.skill-card {
  display: grid;
  min-width: 0;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-lg);
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
  gap: var(--yj-space-4);
  transition:
    border-color var(--yj-motion-fast) var(--yj-ease-standard),
    box-shadow var(--yj-motion-fast) var(--yj-ease-standard);
}

.skill-card:hover,
.skill-card:focus-within {
  border-color: var(--yj-color-border-default);
  box-shadow: var(--yj-shadow-card);
}

.skill-card__main {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--yj-space-3);
}

.skill-card__icon {
  display: inline-flex;
  width: var(--yj-space-12);
  height: var(--yj-space-12);
  align-items: center;
  justify-content: center;
  border: var(--yj-border-width) solid var(--yj-color-brand-border);
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-brand-soft);
}

.skill-card__content {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-1);
}

.skill-card__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-2);
}

.skill-card__title,
.skill-card__description,
.skill-card__error {
  margin: var(--yj-space-0);
}

.skill-card__title {
  min-width: 0;
  overflow: hidden;
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-card-title);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-card-title);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--yj-color-text-secondary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.skill-card__actions {
  display: flex;
  min-width: var(--yj-space-10);
  min-height: var(--yj-space-10);
  align-items: center;
  justify-content: flex-end;
  gap: var(--yj-space-2);
}

.skill-card__delete {
  display: inline-flex;
  width: var(--yj-space-10);
  height: var(--yj-space-10);
  align-items: center;
  justify-content: center;
  padding: var(--yj-space-0);
  border: var(--yj-border-width) solid transparent;
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-icon-muted);
  background: transparent;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    color var(--yj-motion-fast) var(--yj-ease-standard),
    background-color var(--yj-motion-fast) var(--yj-ease-standard),
    opacity var(--yj-motion-fast) var(--yj-ease-standard);
}

.skill-card:hover .skill-card__delete,
.skill-card:focus-within .skill-card__delete,
.skill-card__delete:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.skill-card__delete:hover,
.skill-card__delete:focus-visible {
  color: var(--yj-color-error);
  background: var(--yj-color-error-soft);
}

.skill-card__delete:focus-visible {
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.skill-card__delete:disabled {
  color: var(--yj-color-text-disabled);
  cursor: not-allowed;
}

.skill-card__metadata {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--yj-space-1) var(--yj-space-3);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

.skill-card__metadata > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-card__error {
  color: var(--yj-color-error);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
}

@media (hover: none) {
  .skill-card__delete {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .skill-card,
  .skill-card__delete {
    transition: none;
  }
}
</style>
