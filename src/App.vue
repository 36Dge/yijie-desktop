<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  canRenderProtectedPath,
  requiredCapabilityForPath,
} from "./authorization/app-permission-policy";
import { createPermissionLifecycle, type PermissionLifecycle } from "./authorization/permission-lifecycle";
import { authoritativePermissionUiEnabled } from "./authorization/permission-ui-config";
import { localChatUiEnabled } from "./authorization/chat-ui-config";
import { createChatPermissionLifecycle } from "./authorization/chat-permission-lifecycle";
import {
  darkTheme,
  type GlobalThemeOverrides,
  NConfigProvider,
  NDialogProvider,
  NMessageProvider,
  NNotificationProvider,
} from "naive-ui";
import YjAppShell from "./components/yijie/YjAppShell.vue";
import { createNaiveThemeOverrides } from "./design/theme/naive-theme";
import { usePermissionStore } from "./stores/permission.store";
import { useChatStore } from "./stores/chat.store";
import "./styles/variables.css";

const route = useRoute();
const router = useRouter();
const permissionStore = usePermissionStore();
const chatStore = useChatStore();
const isDark = ref(false);
const themeOverrides = ref<GlobalThemeOverrides>();
let colorSchemeQuery: MediaQueryList | undefined;
let permissionLifecycle: PermissionLifecycle | undefined;
let routeSelectionEpoch = 0;
const opaqueSessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const chatPermissionLifecycle = createChatPermissionLifecycle(chatStore, localChatUiEnabled);

const permissionSnapshot = computed(() => ({
  enabled: authoritativePermissionUiEnabled,
  ready: permissionStore.isReady,
  chatUiEnabled: localChatUiEnabled,
  hasCapability: permissionStore.hasCapability,
}));

async function synchronizeChatAuthority(): Promise<void> {
  await chatPermissionLifecycle.synchronize({
    ready: permissionStore.isReady,
    tenantId: permissionStore.selectedTenantId,
    authorizationRevision: permissionStore.authorizationRevision,
    canCreateTask: permissionStore.hasCapability("task.create"),
    canReadTask: permissionStore.hasCapability("task.read"),
  });
}

async function synchronizeChatRoute(): Promise<void> {
  const epoch = ++routeSelectionEpoch;
  if (!localChatUiEnabled || chatStore.context === null || !chatStore.isReady) return;
  if (route.path === "/chat") {
    await chatStore.clearSelectedSession();
    return;
  }
  if (!route.path.startsWith("/chat/")) return;
  const sessionId = typeof route.params.sessionId === "string" ? route.params.sessionId : "";
  if (!opaqueSessionIdPattern.test(sessionId)) {
    await router.replace("/chat");
    return;
  }
  if (chatStore.selectedSessionId !== sessionId) {
    await chatStore.selectSession(sessionId);
  }
  if (epoch !== routeSelectionEpoch) return;
  if (chatStore.lastErrorCode === "chat_capability_denied") {
    await router.replace({ path: "/access-denied", query: { from: route.path } });
  } else if (
    chatStore.lastErrorCode === "chat_resource_not_found" ||
    chatStore.lastErrorCode === "chat_project_invalid"
  ) {
    await chatStore.clearSelectedSession();
    await router.replace("/chat");
  } else if (chatStore.lastErrorCode === "chat_context_invalid") {
    await router.replace("/settings");
  }
}
const canRenderCurrentRoute = computed(() =>
  canRenderProtectedPath(route.path, permissionSnapshot.value),
);

function applyColorScheme(matches: boolean): void {
  isDark.value = matches;
  document.documentElement.dataset.theme = matches ? "dark" : "light";
  const rootStyles = getComputedStyle(document.documentElement);
  themeOverrides.value = createNaiveThemeOverrides((name) => rootStyles.getPropertyValue(name));
}

function handleColorSchemeChange(event: MediaQueryListEvent): void {
  applyColorScheme(event.matches);
}

async function routeProtectedViewToRecovery(): Promise<void> {
  if (requiredCapabilityForPath(route.path) !== null) {
    await router.replace("/settings");
  }
}

watch(
  [
    () => route.path,
    () => permissionStore.phase,
    () => permissionStore.authorizationRevision,
    () => permissionStore.capabilities,
  ],
  async () => {
    const requiredCapability = requiredCapabilityForPath(route.path);
    if (requiredCapability === null || canRenderCurrentRoute.value) {
      return;
    }
    if (authoritativePermissionUiEnabled && permissionStore.isReady) {
      await router.replace({
        path: "/access-denied",
        query: { from: route.path },
      });
      return;
    }
    await router.replace("/settings");
  },
  { flush: "sync" },
);

watch(
  [
    () => route.path,
    () => route.params.sessionId,
    () => chatStore.context?.contextId,
    () => chatStore.phase,
  ],
  () => { void synchronizeChatRoute(); },
  { flush: "post" },
);

watch(
  () => chatStore.deleteDisposition,
  async (disposition) => {
    if (disposition?.kind === "navigate" && route.path !== disposition.path) {
      await router.replace(disposition.path);
    }
  },
  { flush: "post" },
);

watch(
  [
    () => permissionStore.phase,
    () => permissionStore.selectedTenantId,
    () => permissionStore.authorizationRevision,
    () => permissionStore.capabilities,
  ],
  () => { void synchronizeChatAuthority(); },
  { flush: "sync", immediate: true },
);

onMounted(() => {
  colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyColorScheme(colorSchemeQuery.matches);
  colorSchemeQuery.addEventListener("change", handleColorSchemeChange);

  if (authoritativePermissionUiEnabled) {
    permissionLifecycle = createPermissionLifecycle(
      permissionStore,
      routeProtectedViewToRecovery,
      document,
    );
    void permissionLifecycle.start();
  }
});

onBeforeUnmount(() => {
  colorSchemeQuery?.removeEventListener("change", handleColorSchemeChange);
  permissionLifecycle?.stop();
  void chatPermissionLifecycle.stop();
});
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : null" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <YjAppShell>
            <RouterView v-slot="{ Component }">
              <component :is="Component" v-if="canRenderCurrentRoute" />
            </RouterView>
          </YjAppShell>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
