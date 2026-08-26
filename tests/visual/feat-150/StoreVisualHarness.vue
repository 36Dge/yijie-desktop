<script setup lang="ts">
import { ref } from "vue";
import { darkTheme, NConfigProvider } from "naive-ui";
import { useRoute } from "vue-router";
import YjSidebar from "../../../src/components/yijie/YjSidebar.vue";
import { resolveAppNavigation } from "../../../src/navigation/app-nav";

defineProps<{ dark: boolean }>();

const route = useRoute();
const collapsed = ref(false);
const entries = resolveAppNavigation();
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null">
    <div class="store-visual-shell">
      <YjSidebar
        :entries="entries"
        :collapsed="collapsed"
        :current-path="route.path"
        :show-chat-tree="false"
        @toggle="collapsed = !collapsed"
      />
      <main class="store-visual-shell__content"><RouterView /></main>
    </div>
  </n-config-provider>
</template>

<style scoped>
.store-visual-shell {
  display: flex;
  width: 100%;
  min-width: var(--yj-layout-window-min-width);
  min-height: var(--yj-layout-window-min-height);
  height: 100vh;
  overflow: hidden;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-app);
}

.store-visual-shell__content {
  min-width: 0;
  flex: 1;
  overflow: auto;
  background: var(--yj-color-bg-page);
}
</style>
