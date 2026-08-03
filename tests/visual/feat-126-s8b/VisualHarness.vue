<script setup lang="ts">
import { computed } from "vue";
import { darkTheme, NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from "naive-ui";
import { useRoute } from "vue-router";
import YjSidebar from "../../../src/components/yijie/YjSidebar.vue";
import { resolveAppNavigation } from "../../../src/navigation/app-nav";

defineProps<{ dark: boolean }>();

const route = useRoute();
const entries = computed(() => resolveAppNavigation());
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <div class="visual-shell visual-shell--chat">
            <YjSidebar
              :entries="entries"
              :collapsed="false"
              :current-path="route.path"
              show-chat-tree
              :allow-toggle="false"
            />
            <main class="visual-shell__content"><RouterView /></main>
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.visual-shell {
  display: flex;
  width: 100%;
  min-width: var(--yj-layout-window-min-width);
  min-height: var(--yj-layout-window-min-height);
  height: 100vh;
  overflow: hidden;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.visual-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}

@media (max-width: 700px) {
  .visual-shell--chat { min-width: 0; }
}
</style>
