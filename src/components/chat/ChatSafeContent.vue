<script setup lang="ts">
import { computed } from "vue";
import type {
  ConversationTimelineArtifactReferenceContentBlock,
  ConversationTimelineAttachmentReferenceContentBlock,
  ConversationTimelineContentBlock,
} from "../../domain/conversation-timeline";
import YjIcon from "../yijie/YjIcon.vue";

type SafeInlineNode = Readonly<{
  key: string;
  kind: "text" | "strong" | "emphasis" | "inline_code" | "inert_link";
  text: string;
  destination: string | null;
}>;

type SafeInlineGroup = Readonly<{
  key: string;
  inlines: readonly SafeInlineNode[];
}>;

type SafeContentNode =
  | Readonly<{
      key: string;
      kind: "paragraph";
      inlines: readonly SafeInlineNode[];
    }>
  | Readonly<{
      key: string;
      kind: "list";
      ordered: boolean;
      items: readonly SafeInlineGroup[];
    }>
  | Readonly<{
      key: string;
      kind: "code";
      language: string | null;
      text: string;
    }>
  | Readonly<{
      key: string;
      kind: "table";
      headers: readonly SafeInlineGroup[];
      rows: readonly (readonly SafeInlineGroup[])[];
    }>
  | Readonly<{
      key: string;
      kind: "artifact_reference";
      block: ConversationTimelineArtifactReferenceContentBlock;
    }>
  | Readonly<{
      key: string;
      kind: "attachment_reference";
      block: ConversationTimelineAttachmentReferenceContentBlock;
    }>
  | Readonly<{
      key: string;
      kind: "unknown";
      code: "unsupported_content";
    }>;

const props = withDefaults(defineProps<{
  blocks: readonly ConversationTimelineContentBlock[];
  mode?: "rich" | "plain";
}>(), {
  mode: "rich",
});

defineSlots<{
  "artifact-reference"(props: {
    block: ConversationTimelineArtifactReferenceContentBlock;
  }): unknown;
  "attachment-reference"(props: {
    block: ConversationTimelineAttachmentReferenceContentBlock;
  }): unknown;
  "code-actions"(props: {
    codeIdentity: string;
    text: string;
    language: string | null;
  }): unknown;
}>();

function stableKey(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function inlineNodes(source: string, keyBase: string, plain: boolean): readonly SafeInlineNode[] {
  if (source.length === 0) return Object.freeze([]);
  if (plain) {
    return Object.freeze([Object.freeze({
      key: stableKey(keyBase, "text", "0"),
      kind: "text" as const,
      text: source,
      destination: null,
    })]);
  }

  const nodes: SafeInlineNode[] = [];
  let cursor = 0;
  let plainStart = 0;

  function append(
    kind: SafeInlineNode["kind"],
    text: string,
    destination: string | null = null,
  ): void {
    if (text.length === 0) return;
    nodes.push(Object.freeze({
      key: stableKey(keyBase, kind, String(nodes.length)),
      kind,
      text,
      destination,
    }));
  }

  function flushPlain(end: number): void {
    if (end > plainStart) append("text", source.slice(plainStart, end));
  }

  while (cursor < source.length) {
    if (source[cursor] === "`") {
      const closing = source.indexOf("`", cursor + 1);
      if (closing > cursor + 1) {
        flushPlain(cursor);
        append("inline_code", source.slice(cursor + 1, closing));
        cursor = closing + 1;
        plainStart = cursor;
        continue;
      }
    }

    if (source.startsWith("**", cursor)) {
      const closing = source.indexOf("**", cursor + 2);
      if (closing > cursor + 2) {
        flushPlain(cursor);
        append("strong", source.slice(cursor + 2, closing));
        cursor = closing + 2;
        plainStart = cursor;
        continue;
      }
    }

    if (source[cursor] === "*" && !source.startsWith("**", cursor)) {
      const closing = source.indexOf("*", cursor + 1);
      if (closing > cursor + 1) {
        flushPlain(cursor);
        append("emphasis", source.slice(cursor + 1, closing));
        cursor = closing + 1;
        plainStart = cursor;
        continue;
      }
    }

    if (source[cursor] === "[" && source[cursor - 1] !== "!") {
      const separator = source.indexOf("](", cursor + 1);
      if (separator === -1) break;
      const closing = separator === -1 ? -1 : source.indexOf(")", separator + 2);
      if (closing === -1) break;
      if (separator > cursor + 1 && closing > separator + 2) {
        flushPlain(cursor);
        append(
          "inert_link",
          source.slice(cursor + 1, separator),
          source.slice(separator + 2, closing),
        );
        cursor = closing + 1;
        plainStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  flushPlain(source.length);
  return Object.freeze(nodes);
}

function safeLanguage(value: string | null): string | null {
  const language = value?.trim() ?? "";
  return language.length > 0 && language.length <= 32 && /^[A-Za-z0-9_+-]+$/.test(language)
    ? language
    : null;
}

function tableCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const unwrapped = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "");
  const cells = unwrapped.split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? Object.freeze(cells) : null;
}

function isTableDelimiter(cells: readonly string[] | null): cells is readonly string[] {
  return cells !== null && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function unorderedItem(line: string): string | null {
  return line.match(/^ {0,3}[-+*]\s+(.+)$/)?.[1] ?? null;
}

function orderedItem(line: string): string | null {
  return line.match(/^ {0,3}\d+[.)]\s+(.+)$/)?.[1] ?? null;
}

function fenceLanguage(line: string): string | null | undefined {
  const match = line.match(/^ {0,3}```([^\s`]*)\s*$/);
  return match === null ? undefined : safeLanguage(match[1] ?? null);
}

function nextClosingFenceIndexes(lines: readonly string[]): readonly number[] {
  const indexes = new Array<number>(lines.length).fill(-1);
  let nextClosing = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    indexes[index] = nextClosing;
    if (/^ {0,3}```\s*$/.test(lines[index] ?? "")) nextClosing = index;
  }
  return Object.freeze(indexes);
}

function startsBlock(
  lines: readonly string[],
  closingFenceIndexes: readonly number[],
  index: number,
): boolean {
  const line = lines[index] ?? "";
  if (line.trim().length === 0) return true;
  if (fenceLanguage(line) !== undefined && closingFenceIndexes[index] !== -1) return true;
  if (unorderedItem(line) !== null || orderedItem(line) !== null) return true;
  const header = tableCells(line);
  return header !== null && isTableDelimiter(tableCells(lines[index + 1] ?? ""));
}

function inlineGroup(text: string, key: string, plain: boolean): SafeInlineGroup {
  return Object.freeze({ key, inlines: inlineNodes(text, key, plain) });
}

function markdownNodes(
  text: string,
  keyBase: string,
  plain: boolean,
): readonly SafeContentNode[] {
  if (plain) {
    return text.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          key: stableKey(keyBase, "paragraph", "0"),
          kind: "paragraph" as const,
          inlines: inlineNodes(text, stableKey(keyBase, "paragraph", "0"), true),
        })]);
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const closingFenceIndexes = nextClosingFenceIndexes(lines);
  const nodes: SafeContentNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const language = fenceLanguage(line);
    const closingFence = language === undefined ? -1 : (closingFenceIndexes[index] ?? -1);
    if (language !== undefined && closingFence !== -1) {
      const key = stableKey(keyBase, "code", String(nodes.length));
      nodes.push(Object.freeze({
        key,
        kind: "code" as const,
        language,
        text: lines.slice(index + 1, closingFence).join("\n"),
      }));
      index = closingFence + 1;
      continue;
    }

    const headerCells = tableCells(line);
    const delimiterCells = tableCells(lines[index + 1] ?? "");
    if (
      headerCells !== null &&
      isTableDelimiter(delimiterCells) &&
      headerCells.length === delimiterCells.length
    ) {
      const key = stableKey(keyBase, "table", String(nodes.length));
      const headers = Object.freeze(headerCells.map((cell, cellIndex) =>
        inlineGroup(cell, stableKey(key, "header", String(cellIndex)), false)));
      const rows: (readonly SafeInlineGroup[])[] = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length) {
        const cells = tableCells(lines[rowIndex] ?? "");
        if (cells === null || cells.length !== headers.length) break;
        rows.push(Object.freeze(cells.map((cell, cellIndex) =>
          inlineGroup(
            cell,
            stableKey(key, "row", String(rows.length), String(cellIndex)),
            false,
          ))));
        rowIndex += 1;
      }
      nodes.push(Object.freeze({
        key,
        kind: "table" as const,
        headers,
        rows: Object.freeze(rows),
      }));
      index = rowIndex;
      continue;
    }

    const unordered = unorderedItem(line);
    const ordered = orderedItem(line);
    if (unordered !== null || ordered !== null) {
      const isOrdered = ordered !== null;
      const key = stableKey(keyBase, "list", String(nodes.length));
      const items: SafeInlineGroup[] = [];
      while (index < lines.length) {
        const value = isOrdered
          ? orderedItem(lines[index] ?? "")
          : unorderedItem(lines[index] ?? "");
        if (value === null) break;
        items.push(inlineGroup(value, stableKey(key, "item", String(items.length)), false));
        index += 1;
      }
      nodes.push(Object.freeze({
        key,
        kind: "list" as const,
        ordered: isOrdered,
        items: Object.freeze(items),
      }));
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, closingFenceIndexes, index)) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const key = stableKey(keyBase, "paragraph", String(nodes.length));
    const literalFallback = paragraphLines.some((paragraphLine) =>
      fenceLanguage(paragraphLine) !== undefined);
    const paragraphText = paragraphLines.join(literalFallback ? "\n" : " ");
    nodes.push(Object.freeze({
      key,
      kind: "paragraph" as const,
      inlines: inlineNodes(paragraphText, key, literalFallback),
    }));
  }

  return Object.freeze(nodes);
}

function contentNodes(
  blocks: readonly ConversationTimelineContentBlock[],
  mode: "rich" | "plain",
): readonly SafeContentNode[] {
  const nodes: SafeContentNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "text":
        nodes.push(...markdownNodes(block.text, block.identity, mode === "plain"));
        break;
      case "code":
        nodes.push(Object.freeze({
          key: block.identity,
          kind: "code" as const,
          language: safeLanguage(block.language),
          text: block.text,
        }));
        break;
      case "artifact_reference":
        nodes.push(Object.freeze({ key: block.identity, kind: block.type, block }));
        break;
      case "attachment_reference":
        nodes.push(Object.freeze({ key: block.identity, kind: block.type, block }));
        break;
      case "unknown":
      default:
        nodes.push(Object.freeze({
          key: block.identity,
          kind: "unknown" as const,
          code: "unsupported_content" as const,
        }));
        break;
    }
  }
  return Object.freeze(nodes);
}

const nodes = computed(() => contentNodes(props.blocks, props.mode));
</script>

<template>
  <div class="chat-safe-content">
    <template v-for="node in nodes" :key="node.key">
      <p v-if="node.kind === 'paragraph'" class="chat-safe-content__paragraph">
        <template v-for="inline in node.inlines" :key="inline.key">
          <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code">{{ inline.text }}</code>
          <strong v-else-if="inline.kind === 'strong'">{{ inline.text }}</strong>
          <em v-else-if="inline.kind === 'emphasis'">{{ inline.text }}</em>
          <span v-else-if="inline.kind === 'inert_link'" class="chat-safe-content__inert-link">
            {{ inline.text }}（{{ inline.destination }}）
          </span>
          <span v-else>{{ inline.text }}</span>
        </template>
      </p>

      <ol v-else-if="node.kind === 'list' && node.ordered" class="chat-safe-content__list">
        <li v-for="item in node.items" :key="item.key">
          <template v-for="inline in item.inlines" :key="inline.key">
            <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code">{{ inline.text }}</code>
            <strong v-else-if="inline.kind === 'strong'">{{ inline.text }}</strong>
            <em v-else-if="inline.kind === 'emphasis'">{{ inline.text }}</em>
            <span v-else-if="inline.kind === 'inert_link'" class="chat-safe-content__inert-link">
              {{ inline.text }}（{{ inline.destination }}）
            </span>
            <span v-else>{{ inline.text }}</span>
          </template>
        </li>
      </ol>

      <ul v-else-if="node.kind === 'list'" class="chat-safe-content__list">
        <li v-for="item in node.items" :key="item.key">
          <template v-for="inline in item.inlines" :key="inline.key">
            <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code">{{ inline.text }}</code>
            <strong v-else-if="inline.kind === 'strong'">{{ inline.text }}</strong>
            <em v-else-if="inline.kind === 'emphasis'">{{ inline.text }}</em>
            <span v-else-if="inline.kind === 'inert_link'" class="chat-safe-content__inert-link">
              {{ inline.text }}（{{ inline.destination }}）
            </span>
            <span v-else>{{ inline.text }}</span>
          </template>
        </li>
      </ul>

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
        <pre><code>{{ node.text }}</code></pre>
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
                  <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code">{{ inline.text }}</code>
                  <strong v-else-if="inline.kind === 'strong'">{{ inline.text }}</strong>
                  <em v-else-if="inline.kind === 'emphasis'">{{ inline.text }}</em>
                  <span v-else-if="inline.kind === 'inert_link'" class="chat-safe-content__inert-link">
                    {{ inline.text }}（{{ inline.destination }}）
                  </span>
                  <span v-else>{{ inline.text }}</span>
                </template>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in node.rows" :key="row[0]?.key">
              <td v-for="cell in row" :key="cell.key">
                <template v-for="inline in cell.inlines" :key="inline.key">
                  <code v-if="inline.kind === 'inline_code'" class="chat-safe-content__inline-code">{{ inline.text }}</code>
                  <strong v-else-if="inline.kind === 'strong'">{{ inline.text }}</strong>
                  <em v-else-if="inline.kind === 'emphasis'">{{ inline.text }}</em>
                  <span v-else-if="inline.kind === 'inert_link'" class="chat-safe-content__inert-link">
                    {{ inline.text }}（{{ inline.destination }}）
                  </span>
                  <span v-else>{{ inline.text }}</span>
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

      <div v-else-if="node.kind === 'attachment_reference'" class="chat-safe-content__reference" role="note">
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

.chat-safe-content__inert-link {
  color: var(--yj-color-brand-text);
  text-decoration: underline;
  text-decoration-color: var(--yj-color-brand-border);
  text-underline-offset: var(--yj-space-1);
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
  outline: var(--yj-space-1) solid var(--yj-color-brand-border);
  outline-offset: var(--yj-space-1);
}

.chat-safe-content__code-header {
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
  padding: var(--yj-space-2) var(--yj-space-3);
  border-bottom: var(--yj-border-width) solid var(--yj-color-border-subtle);
  text-align: left;
  white-space: nowrap;
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
  color: var(--yj-color-text-secondary);
  background: var(--yj-color-bg-subtle);
}

.chat-safe-content__unknown {
  color: var(--yj-color-text-secondary);
}
</style>
