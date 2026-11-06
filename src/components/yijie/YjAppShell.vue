<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useRoute } from "vue-router";
import { resolveNavigationVisibility } from "../../authorization/app-permission-policy";
import { authoritativePermissionUiEnabled } from "../../authorization/permission-ui-config";
import { localChatUiEnabled } from "../../authorization/chat-ui-config";
import { skillMarketplaceUiEnabled } from "../../authorization/skill-marketplace-ui-config";
import { storeShowcaseUiEnabled } from "../../authorization/store-showcase-ui-config";
import { workflowShowcaseUiEnabled } from "../../authorization/workflow-showcase-ui-config";
import { marketConnectorsEnabled } from "../../api/market-connectors-client";
import { resolveAppNavigation } from "../../navigation/app-nav";
import { useChatStore } from "../../stores/chat.store";
import { usePermissionStore } from "../../stores/permission.store";
import { useSidebarStore } from "../../stores/sidebar.store";
import { useChatReadingStore } from "../../stores/chat-reading.store";
import YjSidebar from "./YjSidebar.vue";
import YjWindowTitlebar from "./YjWindowTitlebar.vue";
import { provideWorkspaceFullscreen } from "../../composables/useWorkspaceFullscreen";

const route = useRoute();
const fullscreenTarget = useTemplateRef<HTMLElement>("fullscreenHost");
const { active: workspaceFullscreen } = provideWorkspaceFullscreen(fullscreenTarget);
const chatStore = useChatStore();
const sidebarStore = useSidebarStore();
const permissionStore = usePermissionStore();
const isLocalChatRoute = computed(() => localChatUiEnabled && (
  route.path === "/chat" || route.path.startsWith("/chat/")
));
const navigationEntries = computed(() =>
  resolveAppNavigation(
    undefined,
    resolveNavigationVisibility({
      enabled: authoritativePermissionUiEnabled,
      ready: permissionStore.isReady,
      chatUiEnabled: localChatUiEnabled,
      skillMarketplaceUiEnabled,
      storeShowcaseUiEnabled,
      workflowShowcaseUiEnabled,
      connectorsUiEnabled: marketConnectorsEnabled,
      hasCapability: permissionStore.hasCapability,
    }),
  ),
);
const sidebarCollapsed = computed(() => sidebarStore.isCollapsed);
const showTaskHistoryTree = computed(() =>
  localChatUiEnabled &&
  navigationEntries.value.some((entry) => entry.kind === "section" && entry.key === "taskHistory"),
);

let storage: Storage | undefined;

if (typeof window !== "undefined") {
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
}

sidebarStore.hydrate(storage);
useChatReadingStore().hydrate(storage);

function recoverCurrentNewTask(): void {
  void chatStore.clearSelectedSession();
}
</script>

<template>
  <div class="yj-app-shell" :class="{ 'yj-app-shell--chat': isLocalChatRoute, 'yj-app-shell--sidebar-collapsed': sidebarCollapsed, 'yj-app-shell--fullscreen': workspaceFullscreen }">
    <YjWindowTitlebar :collapsed="sidebarCollapsed" :sidebar-visible="!workspaceFullscreen" @toggle="sidebarStore.toggle" />
    <div class="yj-app-shell__body">
      <YjSidebar
        :inert="workspaceFullscreen"
        :entries="navigationEntries"
        :collapsed="sidebarCollapsed"
        :current-path="route.path"
        :show-chat-tree="showTaskHistoryTree"
        @recover-new-task="recoverCurrentNewTask"
      />
      <main class="yj-app-shell__content" :inert="workspaceFullscreen" tabindex="0">
        <slot />
      </main>
      <div v-show="workspaceFullscreen" ref="fullscreenHost" class="yj-app-shell__fullscreen" />
    </div>
  </div>
</template>

<style scoped>
.yj-app-shell {
  --yj-shell-sidebar-width: var(--yj-layout-sidebar-expanded);
  position: relative;
  display: flex;
  flex-direction: column;
  width: var(--yj-ui-viewport-width, 100%);
  min-width: var(--yj-layout-window-min-width);
  min-height: min(var(--yj-layout-window-min-height), var(--yj-ui-viewport-height, 100vh));
  height: var(--yj-ui-viewport-height, 100vh);
  overflow: clip;
  color: var(--yj-color-text-primary);
  /* Continue the navigation surface through the native window-control strip. */
  background: linear-gradient(to right,
    var(--yj-color-bg-nav) var(--yj-shell-sidebar-width),
    var(--yj-color-bg-app) var(--yj-shell-sidebar-width));
}

.yj-app-shell--sidebar-collapsed {
  --yj-shell-sidebar-width: var(--yj-layout-sidebar-collapsed);
}

:global(html:is([data-ui-zoom-percent="180"], [data-ui-zoom-percent="200"]) .yj-app-shell:has(.yj-sidebar--chat-tree)) {
  --yj-shell-sidebar-width: 196px;
}

.yj-app-shell--fullscreen :deep(.yj-window-titlebar) {
  background: var(--yj-color-bg-app);
}

/* Chat headers include the window strip so their contents are centered in the
 * whole top region. Native controls keep their unscaled, reserved corner. */
.yj-app-shell--chat {
  --yj-chat-window-strip: calc(var(--yj-layout-titlebar-height) / var(--yj-ui-scale, 1));
  --yj-layout-chat-toolbar-height: calc(var(--yj-layout-chat-navigation-height) + var(--yj-chat-window-strip));
  --yj-layout-preview-tabs-height: var(--yj-layout-chat-toolbar-height);
  --yj-chat-native-controls-inset: calc(var(--yj-layout-titlebar-controls-inset) / var(--yj-ui-scale, 1));
  --yj-chat-title-leading-inset: 0px;
}

.yj-app-shell--chat.yj-app-shell--sidebar-collapsed {
  --yj-chat-title-leading-inset: max(0px, calc((var(--yj-layout-titlebar-controls-inset) + var(--yj-space-8)) / var(--yj-ui-scale, 1) - var(--yj-layout-sidebar-collapsed)));
}

.yj-app-shell--chat :deep(.yj-window-titlebar) {
  position: absolute;
  top: 0;
  left: 0;
  width: calc(var(--yj-layout-titlebar-controls-inset) + var(--yj-space-8));
  z-index: var(--yj-z-window-controls);
}

.yj-app-shell--chat.yj-app-shell--fullscreen :deep(.yj-window-titlebar) {
  width: var(--yj-layout-titlebar-controls-inset);
}

.yj-app-shell--chat .yj-sidebar { margin-top: var(--yj-chat-window-strip); }

.yj-app-shell__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  /* Layout frames must not scroll when a descendant receives focus or an anchor. */
  overflow: clip;
}

.yj-app-shell__fullscreen {
  position: absolute;
  inset: 0;
  z-index: var(--yj-z-preview-fullscreen);
}

.yj-app-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}

@media (max-width: 700px) {
  .yj-app-shell--chat { min-width: 0; }
  .yj-app-shell:has(.yj-sidebar--chat-tree) { --yj-shell-sidebar-width: 196px; }
}
</style>
