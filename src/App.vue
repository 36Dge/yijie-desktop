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
import { skillMarketplaceUiEnabled } from "./authorization/skill-marketplace-ui-config";
import { storeShowcaseUiEnabled } from "./authorization/store-showcase-ui-config";
import { workflowShowcaseUiEnabled } from "./authorization/workflow-showcase-ui-config";
import { createChatPermissionLifecycle } from "./authorization/chat-permission-lifecycle";
import { demoFastLocalProfileEnabled } from "./authorization/local-profile";
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
import {
  nextUiZoomPercent,
  UI_ZOOM_DEFAULT_PERCENT,
  uiZoomCssValue,
  uiZoomedViewportCss,
  uiZoomedWindowMinimumCss,
} from "./domain/ui-zoom";
import "./styles/variables.css";

const route = useRoute();
const router = useRouter();
const permissionStore = usePermissionStore();
const chatStore = useChatStore();
const isDark = ref(false);
const uiZoomPercent = ref(UI_ZOOM_DEFAULT_PERCENT);
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
  skillMarketplaceUiEnabled,
  storeShowcaseUiEnabled,
  workflowShowcaseUiEnabled,
  hasCapability: permissionStore.hasCapability,
}));

async function synchronizeChatAuthority(): Promise<void> {
  await chatPermissionLifecycle.synchronize({
    ready: permissionStore.isReady,
    tenantId: permissionStore.selectedTenantId,
    authorizationRevision: permissionStore.authorizationRevision,
    expiresAt: permissionStore.expiresAt,
    canCreateTask: permissionStore.hasCapability("task.create"),
    canReadTask: permissionStore.hasCapability("task.read"),
  });
}

async function synchronizeChatRoute(routeChanged: boolean): Promise<void> {
  if (!localChatUiEnabled || chatStore.context === null) return;
  const epoch = routeSelectionEpoch;
  if (route.path === "/chat") {
    if (!routeChanged && (chatStore.selectedSessionId !== null || !chatStore.isReady)) return;
    const newDraftAlreadySelected =
      chatStore.selectedSessionId === null &&
      chatStore.draftTarget?.type === "new" &&
      chatStore.draftTargetReady;
    if (!newDraftAlreadySelected) {
      await chatStore.clearSelectedSession();
    }
    return;
  }
  if (!chatStore.isReady) return;
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

function applyUiZoom(percent: number): void {
  const windowMinimum = uiZoomedWindowMinimumCss(percent);
  const viewport = uiZoomedViewportCss(percent);
  document.documentElement.style.setProperty("zoom", uiZoomCssValue(percent));
  document.documentElement.style.setProperty("--yj-layout-window-min-width", windowMinimum.width);
  document.documentElement.style.setProperty("--yj-layout-window-min-height", windowMinimum.height);
  document.documentElement.style.setProperty("--yj-ui-viewport-width", viewport.width);
  document.documentElement.style.setProperty("--yj-ui-viewport-height", viewport.height);
  document.documentElement.dataset.uiZoomPercent = String(percent);
}

function handleUiZoomShortcut(event: KeyboardEvent): void {
  const nextPercent = nextUiZoomPercent(uiZoomPercent.value, event);
  if (nextPercent === null) return;
  event.preventDefault();
  uiZoomPercent.value = nextPercent;
  applyUiZoom(nextPercent);
}

watch(
  [
    () => route.path,
    () => permissionStore.phase,
    () => permissionStore.authorizationRevision,
    () => permissionStore.expiresAt,
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
  (current, previous) => {
    const routeChanged = current[0] !== previous[0] || current[1] !== previous[1];
    const contextChanged = current[2] !== previous[2];
    if (routeChanged || contextChanged) routeSelectionEpoch += 1;
    void synchronizeChatRoute(routeChanged);
  },
  { flush: "post" },
);

watch(
  () => chatStore.deleteDisposition,
  async (disposition) => {
    if (
      disposition?.kind === "navigate" &&
      route.path === `/chat/${disposition.deletedSessionId}` &&
      route.path !== disposition.path
    ) {
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
  applyUiZoom(uiZoomPercent.value);
  window.addEventListener("keydown", handleUiZoomShortcut);

  if (authoritativePermissionUiEnabled) {
    permissionLifecycle = createPermissionLifecycle(
      permissionStore,
      document,
      !demoFastLocalProfileEnabled,
    );
    void permissionLifecycle.start();
  }
});

onBeforeUnmount(() => {
  colorSchemeQuery?.removeEventListener("change", handleColorSchemeChange);
  window.removeEventListener("keydown", handleUiZoomShortcut);
  document.documentElement.style.removeProperty("zoom");
  document.documentElement.style.removeProperty("--yj-layout-window-min-width");
  document.documentElement.style.removeProperty("--yj-layout-window-min-height");
  document.documentElement.style.removeProperty("--yj-ui-viewport-width");
  document.documentElement.style.removeProperty("--yj-ui-viewport-height");
  delete document.documentElement.dataset.uiZoomPercent;
  permissionLifecycle?.stop();
  void chatPermissionLifecycle.stop();
});
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : null" :theme-overrides="themeOverrides">
    <p
      class="app-zoom-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >界面缩放 {{ uiZoomPercent }}%</p>
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

<style scoped>
.app-zoom-announcement {
  position: fixed;
  width: 1px;
  height: 1px;
  padding: 0;
  border: 0;
  margin: -1px;
  clip-path: inset(50%);
  overflow: hidden;
  white-space: nowrap;
}
</style>
