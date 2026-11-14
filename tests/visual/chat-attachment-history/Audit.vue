<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { NConfigProvider, darkTheme } from "naive-ui";
import ChatAttachmentImage from "../../../src/components/chat/ChatAttachmentImage.vue";
import { useChatAttachmentPresentation } from "../../../src/composables/useChatAttachmentPresentation";
import { chatClient } from "../../../src/api/chat-client";
import { createNaiveThemeOverrides } from "../../../src/design/theme/naive-theme";
import "../../../src/styles/variables.css";
import "../../../src/styles/main.css";
import "../../../src/styles/component-colors.css";
const selected = ref("red"), dark = ref(false), authorized = ref(true), shown = ref(true);
const counts = ref<Record<string, number>>({});
const original = chatClient.attachmentPresentation;
const labels: Record<string, string> = { red: "红", blue: "蓝", green: "绿" };
chatClient.attachmentPresentation = async (_context, target) => {
  if (target.type !== "session") throw new Error("A history session is required");
  const color = target.sessionId;
  counts.value[color] = (counts.value[color] ?? 0) + 1;
  // A normal local read, with a visible one-second first-load delay. No native
  // calls, model requests, durable history changes or third-party resources.
  const response = await fetch(`/.local/media-stress-20261114/image-${color}.png`);
  const blob = await response.blob();
  const imageUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  return { sourcePath: null, imageUrl, expiresAt: Date.now() / 1000 + 30 };
};
onBeforeUnmount(() => { chatClient.attachmentPresentation = original; });
const read = useChatAttachmentPresentation(() => "attachment-audit", () => ({ type: "session", sessionId: selected.value }), () => ["same-image-id"], () => authorized.value, "bound");
watch(dark, value => { document.documentElement.dataset.theme = value ? "dark" : "light"; }, { immediate: true });
const theme = computed(() => { void dark.value; return createNaiveThemeOverrides(name => getComputedStyle(document.documentElement).getPropertyValue(name)); });
</script>
<template>
  <NConfigProvider :theme="dark ? darkTheme : null" :theme-overrides="theme">
    <main>
      <header>
        <button v-for="(label, color) in labels" :key="color" type="button" @click="selected = color">聊天 · {{ label }}</button>
        <label><input v-model="dark" type="checkbox">暗色</label>
        <label><input v-model="shown" type="checkbox">显示附件</label>
        <label><input v-model="authorized" type="checkbox">有读取权限</label>
      </header>
      <p>当前聊天：{{ labels[selected] }}。三个聊天使用同名、同局部 ID 的图片；首次读取延迟一秒。</p>
      <ChatAttachmentImage v-if="shown" :key="selected" attachment-id="same-image-id" name="同名图片.png" status="bound" :scope-key="selected" :disabled="!authorized" :read-presentation="read" />
      <p>读取次数：<output>{{ JSON.stringify(counts) }}</output></p>
      <p>30 秒原生投影期限保持；显示中的附件临近到期续读，后台不续读。仅使用本地普通合成图片。</p>
    </main>
  </NConfigProvider>
</template>
<style scoped>
main { padding: var(--yj-space-6); color: var(--yj-color-text-primary); }
header { display: flex; gap: var(--yj-space-4); flex-wrap: wrap; }
</style>
