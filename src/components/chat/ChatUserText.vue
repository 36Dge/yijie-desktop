<script setup lang="ts">
import { computed } from "vue";
import { userMessageUrlParts } from "../../domain/user-message-urls";
import ChatStreamText from "./ChatStreamText.vue";
import ChatTextLink from "./ChatTextLink.vue";
import ChatSkillPill from "./ChatSkillPill.vue";
import type { PositionedChatSkill } from "../../domain/chat-skills";

const props = withDefaults(defineProps<{ text: string; offset: number; links?: boolean; skills?: readonly PositionedChatSkill[] }>(),
  { links: true, skills: () => [] });
const parts = computed(() => {
  const result: ({ text: string; start: number; url?: string } | { skill: PositionedChatSkill })[] = [];
  let nextSkill = 0;
  const spans = props.links ? userMessageUrlParts(props.text) : [{ text: props.text, start: 0, link: false }];
  for (const span of spans) {
    let start = span.start;
    const end = start + span.text.length;
    const url = span.link ? span.text : undefined;
    while (nextSkill < props.skills.length && props.skills[nextSkill]!.offset <= end) {
      const skill = props.skills[nextSkill++]!;
      if (skill.offset > start) result.push({ text: props.text.slice(start, skill.offset), start, url });
      result.push({ skill });
      start = skill.offset;
    }
    if (start < end) result.push({ text: props.text.slice(start, end), start, url });
  }
  return result;
});
</script>

<template>
  <template v-for="part in parts" :key="'skill' in part ? part.skill.id : part.start">
    <ChatSkillPill v-if="'skill' in part" class="inline-user-skill" :entry="part.skill" />
    <ChatTextLink v-else-if="part.url" user-url :text="part.text" :destination="part.url" :offset="offset + part.start" :streaming="false" />
    <ChatStreamText v-else :text="part.text" :offset="offset + part.start" :streaming="false" />
  </template>
</template>

<style scoped>
.inline-user-skill { margin-inline: var(--yj-space-1); }
</style>
