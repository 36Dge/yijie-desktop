<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import ConnectorMarketView from "../../components/connectors/ConnectorMarketView.vue";
import { useChatStore } from "../../stores/chat.store";
import { useMarketConnectorStore } from "../../stores/market-connectors.store";
import { CHAT_AUTHORITY_RETRY_KEY } from "../../authorization/chat-authority-recovery";
import type { ConnectorPageView } from "../../domain/connector-ui";
import { useMarketConnectorBinding } from "../../composables/useMarketConnectorBinding";

const chat = useChatStore(), connectors = useMarketConnectorStore();
const route = useRoute(), router = useRouter();
const retryAuthority = inject(CHAT_AUTHORITY_RETRY_KEY, async () => false);
const returnTo = computed(() => typeof route.query.from === "string" && /^\/chat(?:\/[0-9a-f-]{36})?$/.test(route.query.from) ? route.query.from : null);
const openServiceId = computed(() => typeof route.query.service === "string" ? route.query.service : null);
const model = computed<ConnectorPageView>(() => !chat.context && !["idle", "binding", "binding-pending", "loading"].includes(chat.phase)
  ? { phase: "unavailable", entries: [], refreshing: false, canManage: false, error: "本机运行环境尚未就绪，请重新读取后继续。" }
  : connectors.model);
useMarketConnectorBinding(computed(() => chat.context?.contextId ?? null));
async function refresh(): Promise<void> { if (!chat.context) await retryAuthority(); if (chat.context) await connectors.refresh(); }
function updateOperationObservation(): void { connectors.setOperationObservation(document.visibilityState === "visible"); }
function refreshOnFocus(): void { updateOperationObservation(); void connectors.refresh(); }
onMounted(() => {
  updateOperationObservation();
  window.addEventListener("focus", refreshOnFocus);
  document.addEventListener("visibilitychange", updateOperationObservation);
});
onBeforeUnmount(() => {
  connectors.setOperationObservation(false);
  window.removeEventListener("focus", refreshOnFocus);
  document.removeEventListener("visibilitychange", updateOperationObservation);
});
</script>

<template>
  <ConnectorMarketView :key="connectors.authorityScope ?? 'unbound'" :model="model" :operation-errors="connectors.operationErrors" :can-return="returnTo !== null" :open-service-id="openServiceId" @refresh="refresh" @action="connectors.execute" @back="returnTo && router.push(returnTo)" />
</template>
