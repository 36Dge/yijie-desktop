<script setup lang="ts">
import { computed, inject, provide, ref, watch } from "vue";
import type { ConversationTimelineArtifactReferenceContentBlock, ConversationTimelineAttachmentReferenceContentBlock, ConversationTimelineContentBlock } from "../../domain/conversation-timeline";
import { createChatMarkdownParser, type ChatMarkdownDocument, type ChatContentNode } from "../../domain/chat-markdown";
import { measureChatRender } from "../../domain/chat-render-performance";
import { chatTextRevealKey, useChatTextReveal } from "../../composables/useChatTextReveal";
import YjIcon from "../yijie/YjIcon.vue";
import ChatStreamText from "./ChatStreamText.vue";
import ChatTextLink from "./ChatTextLink.vue";
import { messageFileWorkspaceKey, messageFileLocationKey, messageLinkTargetKey, type MessageLinkTarget } from "../../composables/useChatMessageLink";

const props = withDefaults(defineProps<{
  blocks?: readonly ConversationTimelineContentBlock[];
  mode?: "rich" | "plain";
  typography?: "answer" | "compact";
  streaming?: boolean;
  animate?: boolean;
  linkTarget?: MessageLinkTarget;
  fileLinks?: boolean;
  /** Internal recursion uses the already parsed tree and the parent's clock. */
  parsedNodes?: readonly ChatContentNode[];
}>(), { blocks: () => [], mode: "rich", typography: "compact", streaming: false, animate: true });

defineSlots<{
  "text-prefix"(): unknown;
  "artifact-reference"(props: { block: ConversationTimelineArtifactReferenceContentBlock }): unknown;
  "attachment-reference"(props: { block: ConversationTimelineAttachmentReferenceContentBlock }): unknown;
  "code-actions"(props: { codeIdentity: string; text: string; language: string | null }): unknown;
}>();
const root = ref<HTMLElement | null>(null);
const workspace = inject(messageFileWorkspaceKey, null);
const locate = inject(messageFileLocationKey, null);
const parse = computed(() => createChatMarkdownParser(Boolean(props.fileLinks && props.linkTarget), workspace?.value));
const documentView = computed<ChatMarkdownDocument>(() => props.parsedNodes ? { nodes: props.parsedNodes, text: "" }
  : measureChatRender("markdown", () => parse.value(props.blocks, props.mode, props.streaming)));
// A relative link and an absolute path line may denote different files. Fold
// them only after Native supplies this session's authoritative workspace.
watch([() => documentView.value.relativeHint?.path, () => props.linkTarget?.itemId, () => locate?.value], () => {
  const file = documentView.value.relativeHint;
  if (file && props.linkTarget) void locate?.value?.(props.linkTarget, file).catch(() => {});
}, { immediate: true });
const inherited = inject(chatTextRevealKey, null);
const reveal = props.parsedNodes && inherited ? inherited
  : useChatTextReveal(() => documentView.value.text, () => props.streaming, () => props.animate, root);
provide(chatTextRevealKey, reveal);
if (!props.parsedNodes) provide(messageLinkTargetKey, () => props.linkTarget);
const nodes = computed(() => documentView.value.nodes);
const displayNodes = computed<readonly ChatContentNode[]>((previous) => {
  const cursor = reveal.frame.value.cursor;
  const visible = nodes.value.filter(node => (node.startOffset < cursor || node.startOffset === node.endOffset && node.startOffset <= cursor) || node.kind === "artifact_reference" || node.kind === "attachment_reference" || node.kind === "unknown");
  const ordered = props.mode === "plain" ? [...visible.filter(node => node.kind === "attachment_reference"), ...visible.filter(node => node.kind !== "attachment_reference")] : visible;
  // A reveal frame inside one block does not invalidate its surrounding layout.
  if (previous?.length === ordered.length && ordered.every((node, i) => node === previous[i])) return previous;
  return ordered;
});
const hasAttachments = computed(() => props.mode === "plain" && nodes.value.some(node => node.kind === "attachment_reference"));
const firstParagraphKey = computed(() => nodes.value.find(node => node.kind === "paragraph")?.key);
function visibleItems<T extends { startOffset: number; endOffset: number }>(items: readonly T[]) { return items.filter(item => item.startOffset < reveal.frame.value.cursor || item.startOffset === item.endOffset && item.startOffset <= reveal.frame.value.cursor); }
function visibleRows<T extends readonly { startOffset: number }[]>(rows: readonly T[]) { return rows.filter(row => (row[0]?.startOffset ?? Infinity) <= reveal.frame.value.cursor); }
</script>

<template>
  <div ref="root" class="chat-safe-content yj-selectable-text" :class="{ 'chat-safe-content--attachments': hasAttachments, 'chat-safe-content--answer': typography === 'answer' && mode === 'rich' }">
    <p v-if="$slots['text-prefix'] && !firstParagraphKey" class="chat-safe-content__paragraph"><slot name="text-prefix" /></p>
    <template v-for="node in displayNodes" :key="node.key">
      <p v-if="node.kind === 'paragraph'" class="chat-safe-content__paragraph">
        <slot v-if="node.key === firstParagraphKey" name="text-prefix" />
        <template v-for="inline in node.inlines" :key="inline.key">
          <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></code>
          <strong v-else-if="inline.kind === 'strong'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></strong>
          <em v-else-if="inline.kind === 'emphasis'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></em>
          <del v-else-if="inline.kind === 'strikethrough'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></del>
          <ChatTextLink v-else-if="inline.kind === 'inert_link' || inline.kind === 'file_link'" :file="inline.file" :text="inline.text" :destination="inline.destination" :streaming="streaming" :offset="inline.startOffset" />
          <span v-else><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></span>
        </template>
      </p>

      <component
        :is="`h${node.level}`"
        v-else-if="node.kind === 'heading'"
        class="chat-safe-content__heading"
      >
        <template v-for="inline in node.inlines" :key="inline.key">
          <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></code>
          <strong v-else-if="inline.kind === 'strong'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></strong>
          <em v-else-if="inline.kind === 'emphasis'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></em>
          <del v-else-if="inline.kind === 'strikethrough'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></del>
          <ChatTextLink v-else-if="inline.kind === 'inert_link' || inline.kind === 'file_link'" :file="inline.file" :text="inline.text" :destination="inline.destination" :streaming="streaming" :offset="inline.startOffset" />
          <span v-else><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></span>
        </template>
      </component>

      <hr v-else-if="node.kind === 'rule'" class="chat-safe-content__rule">

      <blockquote v-else-if="node.kind === 'quote'" class="chat-safe-content__quote">
        <ChatSafeContent :parsed-nodes="node.children" mode="rich" :typography="typography" :streaming="streaming">
          <template v-if="$slots['code-actions']" #code-actions="scope">
            <slot name="code-actions" v-bind="scope" />
          </template>
        </ChatSafeContent>
      </blockquote>

      <component
        :is="node.ordered ? 'ol' : 'ul'"
        v-else-if="node.kind === 'list'"
        :start="node.ordered ? node.start : undefined"
        class="chat-safe-content__list"
      >
        <li v-for="item in visibleItems(node.items)" :key="item.key" :class="{ 'chat-safe-content__list-item--loose': item.children.length > 1 }">
          <ChatSafeContent :parsed-nodes="item.children" mode="rich" :typography="typography" :streaming="streaming">
            <template v-if="$slots['code-actions']" #code-actions="scope">
              <slot name="code-actions" v-bind="scope" />
            </template>
          </ChatSafeContent>
        </li>
      </component>

      <div
        v-else-if="node.kind === 'code'"
        class="chat-safe-content__code-region"
        tabindex="0"
        aria-label="代码内容，可横向滚动"
      >
        <div
          v-if="node.language || $slots['code-actions']"
          class="chat-safe-content__code-header"
        >
          <span v-if="node.language" class="chat-safe-content__language">{{ node.language }}</span>
          <span v-else class="chat-safe-content__language">代码</span>
          <div
            v-if="$slots['code-actions']"
            class="chat-safe-content__code-actions"
            role="group"
            aria-label="代码操作"
          >
            <slot
              name="code-actions"
              :code-identity="node.key"
              :text="node.text"
              :language="node.language"
            />
          </div>
        </div>
        <pre><code><ChatStreamText :text="node.text" :streaming="streaming" :offset="node.startOffset" /></code></pre>
      </div>

      <div
        v-else-if="node.kind === 'table'"
        class="chat-safe-content__table-region"
        tabindex="0"
        aria-label="数据表格，可横向滚动"
      >
        <table>
          <thead>
            <tr>
              <th v-for="header in node.headers" :key="header.key" scope="col">
                <template v-for="inline in header.inlines" :key="inline.key">
                  <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></code>
                  <strong v-else-if="inline.kind === 'strong'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></strong>
                  <em v-else-if="inline.kind === 'emphasis'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></em>
                  <del v-else-if="inline.kind === 'strikethrough'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></del>
                  <ChatTextLink v-else-if="inline.kind === 'inert_link' || inline.kind === 'file_link'" :file="inline.file" :text="inline.text" :destination="inline.destination" :streaming="streaming" :offset="inline.startOffset" />
                  <span v-else><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></span>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visibleRows(node.rows)" :key="row[0]?.key">
              <td v-for="cell in row" :key="cell.key">
                <template v-for="inline in cell.inlines" :key="inline.key">
                  <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></code>
                  <strong v-else-if="inline.kind === 'strong'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></strong>
                  <em v-else-if="inline.kind === 'emphasis'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></em>
                  <del v-else-if="inline.kind === 'strikethrough'"><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></del>
                  <ChatTextLink v-else-if="inline.kind === 'inert_link' || inline.kind === 'file_link'" :file="inline.file" :text="inline.text" :destination="inline.destination" :streaming="streaming" :offset="inline.startOffset" />
                  <span v-else><ChatStreamText :text="inline.text" :streaming="streaming" :offset="inline.startOffset" /></span>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-else-if="node.kind === 'artifact_reference'" class="chat-safe-content__reference" role="note">
        <slot name="artifact-reference" :block="node.block">
          <YjIcon name="file" size="sm" tone="muted" />
          <span>生成内容引用：{{ node.block.label ?? "生成内容" }}</span>
        </slot>
      </div>

      <div v-else-if="node.kind === 'attachment_reference'" class="chat-safe-content__attachment" role="note">
        <slot name="attachment-reference" :block="node.block">
          <YjIcon :name="node.block.kind === 'image' ? 'image' : 'file'" size="sm" tone="muted" />
          <span>附件引用：{{ node.block.name }}</span>
        </slot>
      </div>

      <p v-else class="chat-safe-content__unknown" role="note">
        此内容暂不支持（{{ node.code }}）
      </p>
    </template>
  </div>
</template>

<style scoped>
.chat-safe-content {
  display: grid;
  min-width: 0;
  gap: var(--yj-space-3);
  color: var(--yj-color-text-primary);
  font-size: var(--yj-font-size-body);
  line-height: var(--yj-line-height-body);
  overflow-wrap: anywhere;
}

.chat-safe-content__paragraph,
.chat-safe-content__list,
.chat-safe-content__unknown,
.chat-safe-content pre {
  margin: var(--yj-space-0);
}

.chat-safe-content__paragraph {
  white-space: pre-wrap;
}

.chat-safe-content__heading {
  margin: var(--yj-space-0);
  font-size: var(--yj-font-size-body);
  font-weight: var(--yj-font-weight-semibold);
  line-height: var(--yj-line-height-body);
}

.chat-safe-content__heading:not(:first-child) {
  margin-block-start: var(--yj-space-3);
}

h1.chat-safe-content__heading {
  font-size: var(--yj-font-size-page-title);
  line-height: var(--yj-line-height-page-title);
}

h2.chat-safe-content__heading {
  font-size: var(--yj-font-size-section-title);
  line-height: var(--yj-line-height-section-title);
}

h3.chat-safe-content__heading {
  font-size: var(--yj-font-size-card-title);
  line-height: var(--yj-line-height-card-title);
}

.chat-safe-content__rule {
  width: 100%;
  margin: var(--yj-space-2) var(--yj-space-0);
  border: 0;
  border-block-start: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.chat-safe-content__quote {
  min-width: 0;
  margin: var(--yj-space-0);
  padding-inline-start: var(--yj-space-4);
  border-inline-start: var(--yj-border-width) solid var(--yj-color-border-strong);
}

.chat-safe-content__list {
  display: grid;
  gap: var(--yj-space-1);
  padding-inline-start: var(--yj-space-6);
}

.chat-safe-content__inline-code {
  padding: var(--yj-space-0) var(--yj-space-1);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-xs);
  background: var(--yj-color-bg-subtle);
  white-space: break-spaces;
}


.chat-safe-content__code-region,
.chat-safe-content__table-region {
  min-width: 0;
  overflow-x: auto;
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  background: var(--yj-color-bg-subtle);
}

.chat-safe-content__code-region {
  display: grid;
}

.chat-safe-content__code-region:focus-visible,
.chat-safe-content__table-region:focus-visible {
  outline: var(--yj-focus-ring-width) solid var(--yj-color-focus-ring);
  outline-offset: var(--yj-space-1);
}

.chat-safe-content__code-header {
  -webkit-user-select: none;
  user-select: none;
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--yj-space-2);
  padding: var(--yj-space-1) var(--yj-space-3);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
}

.chat-safe-content__language {
  min-width: 0;
  color: var(--yj-color-text-tertiary);
  font-size: var(--yj-font-size-caption);
  line-height: var(--yj-line-height-caption);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-safe-content__code-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.chat-safe-content pre {
  padding: var(--yj-space-3);
  color: var(--yj-color-text-primary);
  white-space: pre;
}

.chat-safe-content table {
  width: 100%;
  border-collapse: collapse;
}

.chat-safe-content th,
.chat-safe-content td {
  min-width: 8em;
  padding: var(--yj-space-2) var(--yj-space-3);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
  text-align: left;
  vertical-align: top;
  white-space: normal;
  overflow-wrap: anywhere;
}

.chat-safe-content th {
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-card);
  font-weight: var(--yj-font-weight-semibold);
}

.chat-safe-content tbody tr:last-child td {
  border-bottom: 0;
}

.chat-safe-content__reference {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: var(--yj-space-2);
  padding: var(--yj-space-2) var(--yj-space-3);
  border: var(--yj-border-width) solid var(--yj-color-border-subtle);
  border-radius: var(--yj-radius-md);
  color: var(--yj-color-text-body);
  background: var(--yj-color-bg-subtle);
}

.chat-safe-content__reference:has(.artifact-list__link) { padding: 0; border: 0; background: transparent; }

.chat-safe-content__unknown {
  color: var(--yj-color-text-body);
}

/* Reading rhythm belongs to answers, not user messages or process controls.
 * Recursion receives the same variant so lists and quotes retain the rhythm. */
.chat-safe-content--answer {
  gap: 0;
  line-height: var(--yj-line-height-chat-answer);
}
.chat-safe-content--answer > * + * { margin-block-start: var(--yj-chat-paragraph-gap); }
.chat-safe-content--answer > .chat-safe-content__heading:not(:first-child) { margin-block-start: var(--yj-chat-section-gap); }
.chat-safe-content--answer > .chat-safe-content__heading + .chat-safe-content__heading { margin-block-start: var(--yj-chat-paragraph-gap); }
.chat-safe-content--answer > .chat-safe-content__heading + :not(.chat-safe-content__heading),
.chat-safe-content--answer > .chat-safe-content__paragraph + .chat-safe-content__list { margin-block-start: var(--yj-chat-heading-content-gap); }
.chat-safe-content--answer > .chat-safe-content__heading { line-height: var(--yj-line-height-chat-answer-heading); }
.chat-safe-content--answer > h1.chat-safe-content__heading { font-size: var(--yj-font-size-chat-answer-title); }
.chat-safe-content--answer strong { font-weight: var(--yj-font-weight-semibold); }
.chat-safe-content--answer > .chat-safe-content__list > .chat-safe-content__list-item--loose + li,
.chat-safe-content--answer > .chat-safe-content__list > li + .chat-safe-content__list-item--loose { margin-block-start: var(--yj-space-1); }
.chat-safe-content--answer .chat-safe-content__inline-code,
.chat-safe-content--answer pre { font-family: var(--yj-font-family-mono); }
.chat-safe-content--answer pre { font-size: var(--yj-font-size-code); line-height: var(--yj-line-height-code); }
.chat-safe-content--answer pre code { font: inherit; }
.chat-safe-content--answer th,
.chat-safe-content--answer td { font-size: var(--yj-font-size-body); line-height: var(--yj-line-height-body); }
</style>

<style scoped>
.chat-safe-content--attachments { display: flex; flex-wrap: wrap; align-items: center; gap: var(--yj-space-2); }
.chat-safe-content__attachment { display: inline-flex; min-width: 0; max-width: 100%; }
.chat-safe-content--attachments > .chat-safe-content__paragraph { min-width: 0; }
</style>
