<script setup lang="ts">
import { ref } from "vue";
import { useRotatingPlaceholder } from "../../composables/useRotatingPlaceholder";

const prompt = ref("");
const { placeholder, onFocus, onBlur } = useRotatingPlaceholder(prompt);
</script>

<template>
  <section class="chat-entry" aria-labelledby="new-task-title">
    <div class="chat-entry__content">
      <h1 id="new-task-title" class="chat-entry__heading">易界AI</h1>
      <p id="new-task-subtitle" class="chat-entry__subtitle">一句话搞定跨境业务。</p>
      <textarea
        v-model="prompt"
        class="chat-entry__composer"
        :placeholder="placeholder"
        aria-label="输入你的跨境业务需求"
        aria-describedby="new-task-subtitle"
        autocomplete="off"
        spellcheck="true"
        @focus="onFocus"
        @blur="onBlur"
      />
    </div>
  </section>
</template>

<style scoped>
.chat-entry {
  display: grid;
  width: 100%;
  min-height: 100%;
  grid-template-rows:
    var(--yj-layout-chat-entry-top-offset) auto
    minmax(var(--yj-space-0), 1fr);
  padding: var(--yj-space-8);
  background: var(--yj-color-bg-page);
}

.chat-entry__content {
  width: min(100%, var(--yj-layout-form-max));
  grid-row: 2;
  margin-inline: auto;
}

.chat-entry__heading {
  margin: var(--yj-space-0);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-display);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-display);
  text-align: center;
}

.chat-entry__subtitle {
  margin: var(--yj-space-3) var(--yj-space-0) var(--yj-space-10);
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-regular);
  line-height: var(--yj-line-height-body);
  text-align: center;
}

.chat-entry__composer {
  display: block;
  width: 100%;
  height: var(--yj-layout-composer-height);
  min-height: var(--yj-layout-composer-height);
  resize: none;
  padding: var(--yj-space-5);
  border: var(--yj-border-width) solid var(--yj-color-border-default);
  border-radius: var(--yj-radius-xl);
  outline: none;
  color: var(--yj-color-text-primary);
  background: var(--yj-color-bg-card);
  box-shadow: var(--yj-shadow-xs);
  caret-color: var(--yj-color-brand-active);
  font: inherit;
  transition:
    border-color var(--yj-motion-fast) var(--yj-ease-standard),
    box-shadow var(--yj-motion-fast) var(--yj-ease-standard);
}

.chat-entry__composer::placeholder {
  color: var(--yj-color-text-tertiary);
  opacity: 1;
}

.chat-entry__composer:hover {
  border-color: var(--yj-color-border-strong);
}

.chat-entry__composer:focus {
  border-color: var(--yj-color-brand-active);
  box-shadow:
    var(--yj-shadow-xs),
    var(--yj-space-0) var(--yj-space-0) var(--yj-space-0) var(--yj-space-1)
      var(--yj-color-brand-border);
}

@media (prefers-reduced-motion: reduce) {
  .chat-entry__composer {
    transition: none;
  }
}
</style>
