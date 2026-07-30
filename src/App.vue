<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
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
import "./styles/variables.css";

const isDark = ref(false);
const themeOverrides = ref<GlobalThemeOverrides>();
let colorSchemeQuery: MediaQueryList | undefined;

function applyColorScheme(matches: boolean): void {
  isDark.value = matches;
  document.documentElement.dataset.theme = matches ? "dark" : "light";
  const rootStyles = getComputedStyle(document.documentElement);
  themeOverrides.value = createNaiveThemeOverrides((name) => rootStyles.getPropertyValue(name));
}

function handleColorSchemeChange(event: MediaQueryListEvent): void {
  applyColorScheme(event.matches);
}

onMounted(() => {
  colorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  applyColorScheme(colorSchemeQuery.matches);
  colorSchemeQuery.addEventListener("change", handleColorSchemeChange);
});

onBeforeUnmount(() => {
  colorSchemeQuery?.removeEventListener("change", handleColorSchemeChange);
});
</script>

<template>
  <n-config-provider :theme="isDark ? darkTheme : null" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <YjAppShell>
            <RouterView />
          </YjAppShell>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
