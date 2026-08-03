<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { resolveNavigationVisibility } from "../../authorization/app-permission-policy";
import { authoritativePermissionUiEnabled } from "../../authorization/permission-ui-config";
import { localChatUiEnabled } from "../../authorization/chat-ui-config";
import { resolveAppNavigation } from "../../navigation/app-nav";
import { usePermissionStore } from "../../stores/permission.store";
import { useSidebarStore } from "../../stores/sidebar.store";
import YjSidebar from "./YjSidebar.vue";

const route = useRoute();
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
      hasCapability: permissionStore.hasCapability,
    }),
  ),
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
</script>

<template>
  <div class="yj-app-shell" :class="{ 'yj-app-shell--chat': isLocalChatRoute }">
    <YjSidebar
      :entries="navigationEntries"
      :collapsed="isLocalChatRoute ? false : sidebarStore.isCollapsed"
      :current-path="route.path"
      :show-chat-tree="isLocalChatRoute"
      :allow-toggle="!isLocalChatRoute"
      @toggle="sidebarStore.toggle"
    />
    <main class="yj-app-shell__content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.yj-app-shell {
  display: flex;
  width: 100%;
  min-width: var(--yj-layout-window-min-width);
  min-height: var(--yj-layout-window-min-height);
  height: 100vh;
  overflow: hidden;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.yj-app-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}

@media (max-width: 700px) {
  .yj-app-shell--chat { min-width: 0; }
}
</style>
