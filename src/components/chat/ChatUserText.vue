<script setup lang="ts">
import { computed } from "vue";
import { userMessageUrlParts } from "../../domain/user-message-urls";
import ChatStreamText from "./ChatStreamText.vue";
import ChatTextLink from "./ChatTextLink.vue";

const props = defineProps<{ text: string; offset: number }>();
const parts = computed(() => userMessageUrlParts(props.text));
</script>

<template>
  <template v-for="part in parts" :key="part.start">
    <ChatTextLink v-if="part.link" user-url :text="part.text" :destination="part.text" :offset="offset + part.start" :streaming="false" />
    <ChatStreamText v-else :text="part.text" :offset="offset + part.start" :streaming="false" />
  </template>
</template>
