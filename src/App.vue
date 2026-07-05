<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NMessageProvider, NNotificationProvider } from "naive-ui";

const themeOverrides = {
  common: {
    primaryColor: "#1f6feb",
    primaryColorHover: "#2f7df6",
    primaryColorPressed: "#185abc",
    borderRadius: "6px",
  },
};
</script>

<template>
  <n-config-provider :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <RouterView />
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
