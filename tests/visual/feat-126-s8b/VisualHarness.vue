<script setup lang="ts">
import { computed, ref } from "vue";
import { darkTheme, NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from "naive-ui";
import { useRoute } from "vue-router";
import YjWindowTitlebar from "../../../src/components/yijie/YjWindowTitlebar.vue";
import YjSidebar from "../../../src/components/yijie/YjSidebar.vue";
import { resolveAppNavigation } from "../../../src/navigation/app-nav";

defineProps<{ dark: boolean }>();

const route = useRoute();
const collapsed = ref(false);
const entries = computed(() => resolveAppNavigation());
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <div class="visual-shell visual-shell--chat">
            <YjWindowTitlebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
            <div class="visual-shell__body">
              <YjSidebar
                :entries="entries"
                :collapsed="collapsed"
                :current-path="route.path"
                show-chat-tree
              />
              <main class="visual-shell__content"><RouterView /></main>
            </div>
          </div>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.visual-shell {
  display: flex;
  flex-direction: column;
  width: var(--yj-ui-viewport-width, 100%);
  min-width: var(--yj-layout-window-min-width);
  min-height: min(var(--yj-layout-window-min-height), var(--yj-ui-viewport-height, 100vh));
  height: var(--yj-ui-viewport-height, 100vh);
  overflow: hidden;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.visual-shell__body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

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
