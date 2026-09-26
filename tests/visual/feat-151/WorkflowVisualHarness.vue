<script setup lang="ts">
import { ref } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import { useRoute } from "vue-router";
import YjWindowTitlebar from "../../../src/components/yijie/YjWindowTitlebar.vue";
import YjSidebar from "../../../src/components/yijie/YjSidebar.vue";
import { resolveAppNavigation } from "../../../src/navigation/app-nav";

defineProps<{ dark: boolean }>();

const route = useRoute();
const collapsed = ref(false);
const entries = resolveAppNavigation();
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null">
    <div class="workflow-visual-shell">
      <YjWindowTitlebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
      <div class="workflow-visual-shell__body">
        <YjSidebar
          :entries="entries"
          :collapsed="collapsed"
          :current-path="route.path"
          :show-chat-tree="false"
        />
        <main class="workflow-visual-shell__content" tabindex="0"><RouterView /></main>
      </div>
    </div>
  </n-config-provider>
</template>

<style scoped>
.workflow-visual-shell {
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

.workflow-visual-shell__body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

.workflow-visual-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}
</style>
