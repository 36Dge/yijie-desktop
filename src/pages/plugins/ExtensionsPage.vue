<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { NButton } from "naive-ui";
import { expertsUiEnabled } from "../../authorization/experts-ui-config";
import { CHAT_AUTHORITY_RETRY_KEY } from "../../authorization/chat-authority-recovery";
import { useExpertSummon } from "../../composables/useExpertSummon";
import { useChatExpertsBinding } from "../../composables/useChatExpertsBinding";
import { useExpertsBinding } from "../../composables/useExpertsBinding";
import { useExpertsStore } from "../../stores/experts.store";
import { useChatStore } from "../../stores/chat.store";
import ExpertMarketPanel from "../../components/experts/ExpertMarketPanel.vue";
import YjPage from "../../components/yijie/YjPage.vue";
import YjPageHeader from "../../components/yijie/YjPageHeader.vue";
import YjTabs from "../../components/yijie/YjTabs.vue";
import YjIcon from "../../components/yijie/YjIcon.vue";
import SkillMarketplacePage from "./SkillMarketplacePage.vue";

const route = useRoute(), router = useRouter(), chat = useChatStore(), experts = useExpertsStore();
const summon = useExpertSummon();
if (expertsUiEnabled) useChatExpertsBinding(computed(() => chat.context?.contextId ?? null), summon.session);
const retryAuthority = inject(CHAT_AUTHORITY_RETRY_KEY, async () => false);
const tabs = [{ key: "skills", label: "技能" }, { key: "experts", label: "专家" }];
const tab = computed(() => route.query.tab === "experts" ? "experts" : "skills");
const skillsPage = ref<InstanceType<typeof SkillMarketplacePage> | null>(null);
const returnTo = computed(() => typeof route.query.from === "string" && /^\/chat(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(route.query.from) ? route.query.from : null);
if (expertsUiEnabled) useExpertsBinding(computed(() => chat.context?.contextId ?? null));
function changeTab(value: string): void { void router.replace({ path: "/plugins", query: { ...route.query, tab: value } }); }
async function refresh(): Promise<void> { if (!chat.context) await retryAuthority(); await experts.refresh(); }
</script>

<template>
  <SkillMarketplacePage v-if="!expertsUiEnabled" />
  <YjPage v-else width="full" class="extensions-page">
    <YjPageHeader title="扩展" :description="tab === 'skills' ? '发现、离线安装和管理跨境电商 Skill。只有已安装且已启用的 Skill 才会向模型开放。' : '查看专家的擅长领域与知识范围，按需准备本地资源。'">
      <template #actions>
        <NButton v-if="tab === 'skills'" secondary :loading="skillsPage?.refreshing" :disabled="skillsPage?.rescanDisabled" aria-label="重新扫描本地 Skill" @click="skillsPage?.rescan()"><template #icon><YjIcon name="refresh" /></template>重新扫描</NButton>
        <template v-else>
          <NButton v-if="returnTo" secondary @click="router.push(returnTo)">返回对话</NButton>
          <NButton secondary :loading="experts.refreshing" @click="refresh">重新读取</NButton>
        </template>
      </template>
    </YjPageHeader>
    <YjTabs :items="tabs" :model-value="tab" aria-label="扩展类型" @update:model-value="changeTab" />
    <section v-show="tab === 'skills'" class="extensions-page__panel" aria-label="技能目录">
      <SkillMarketplacePage ref="skillsPage" embedded :active="tab === 'skills'" />
    </section>
    <section v-show="tab === 'experts'" class="extensions-page__panel" aria-label="专家列表">
      <ExpertMarketPanel :active="tab === 'experts'" :open-expert-id="typeof route.query.expert === 'string' ? route.query.expert : undefined" :open-expert-version="typeof route.query.expertVersion === 'string' ? route.query.expertVersion : undefined" :selected-expert="summon.selected.value" :summon-busy="summon.busy.value" :summon-error="summon.error.value" @summon="summon.summon" />
    </section>
  </YjPage>
</template>

<style scoped>
.extensions-page { display: flex; flex-direction: column; gap: var(--yj-space-6); height: 100%; min-height: 0; overflow: hidden; }
.extensions-page > :not(.extensions-page__panel) { flex-shrink: 0; }
.extensions-page__panel { flex: 1; min-height: 0; overflow-y: auto; }
</style>
