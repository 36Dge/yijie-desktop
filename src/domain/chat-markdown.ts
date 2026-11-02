import type { ConversationTimelineArtifactReferenceContentBlock, ConversationTimelineAttachmentReferenceContentBlock, ConversationTimelineContentBlock } from "./conversation-timeline";

type SafeInlineNode = Readonly<{
  key: string;
  kind: "text" | "strong" | "emphasis" | "strikethrough" | "inline_code" | "inert_link";
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
      kind: "heading";
      level: number;
      inlines: readonly SafeInlineNode[];
    }>
  | Readonly<{ key: string; kind: "rule" }>
  | Readonly<{ key: string; kind: "quote"; text: string }>
  | Readonly<{
      key: string;
      kind: "list";
      ordered: boolean;
      start: number;
      items: readonly Readonly<{ key: string; text: string }>[];
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

function stableKey(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function inlineNodes(source: string, keyBase: string, plain: boolean, streaming: boolean): readonly SafeInlineNode[] {
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
    if (source[cursor] === "\\" && /[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]/.test(source[cursor + 1] ?? "")) {
      flushPlain(cursor);
      append("text", source[cursor + 1]!);
      cursor += 2;
      plainStart = cursor;
      continue;
    }

    if (source[cursor] === "`") {
      const closing = source.indexOf("`", cursor + 1);
      if (closing > cursor + 1) {
        flushPlain(cursor);
        append("inline_code", source.slice(cursor + 1, closing));
        cursor = closing + 1;
        plainStart = cursor;
        continue;
      }
      if (streaming && closing === -1) {
        flushPlain(cursor);
        append("inline_code", source.slice(cursor + 1));
        plainStart = cursor = source.length;
        continue;
      }
    }

    const delimiter = source.startsWith("**", cursor) ? "**"
      : source.startsWith("__", cursor) ? "__"
      : source.startsWith("~~", cursor) ? "~~" : null;
    if (delimiter) {
      const closing = source.indexOf(delimiter, cursor + 2);
      if (closing > cursor + 2) {
        flushPlain(cursor);
        append(delimiter === "~~" ? "strikethrough" : "strong", source.slice(cursor + 2, closing));
        cursor = closing + 2;
        plainStart = cursor;
        continue;
      }
      // A live suffix may not have received its closing marker yet. Keep the
      // same formatted node as it arrives; settled/malformed text keeps the old fallback.
      if (streaming && closing === -1) {
        flushPlain(cursor);
        const suffix = source.slice(cursor + 2);
        append(delimiter === "~~" ? "strikethrough" : "strong",
          suffix.endsWith(delimiter[0]!) ? suffix.slice(0, -1) : suffix);
        plainStart = cursor = source.length;
        continue;
      }
    }

    if ((source[cursor] === "*" && !source.startsWith("**", cursor)) ||
        (source[cursor] === "_" && !source.startsWith("__", cursor) && !/[\p{L}\p{N}]/u.test(source[cursor - 1] ?? ""))) {
      const closing = source.indexOf(source[cursor]!, cursor + 1);
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
      if (separator === -1) {
        const labelEnd = source.indexOf("]", cursor + 1);
        if (streaming && (labelEnd === -1 || labelEnd === source.length - 1)) {
          flushPlain(cursor);
          append("inert_link", source.slice(cursor + 1, labelEnd === -1 ? undefined : labelEnd));
          plainStart = source.length;
        }
        break;
      }
      let depth = 1;
      let closing = separator + 2;
      for (; closing < source.length; closing++) {
        if (source[closing] === "(") depth++;
        else if (source[closing] === ")" && --depth === 0) break;
      }
      if (closing === source.length) {
        if (streaming) {
          flushPlain(cursor);
          append("inert_link", source.slice(cursor + 1, separator));
          plainStart = source.length;
        }
        break;
      }
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

function heading(line: string): { level: number; text: string } | null {
  const match = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
  return match ? { level: match[1]!.length, text: (match[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "") } : null;
}

function isRule(line: string): boolean {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function listMarker(line: string): { indent: number; width: number; ordered: boolean; start: number; text: string } | null {
  const match = line.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/);
  if (!match) return null;
  const ordered = /^\d/.test(match[2]!);
  return {
    indent: match[1]!.length,
    width: match[1]!.length + match[2]!.length + match[3]!.length,
    ordered,
    start: ordered ? parseInt(match[2]!, 10) : 1,
    text: match[4]!,
  };
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
  streaming: boolean,
): boolean {
  const line = lines[index] ?? "";
  if (line.trim().length === 0) return true;
  if (fenceLanguage(line) !== undefined && (closingFenceIndexes[index] !== -1 || streaming)) return true;
  if (heading(line) || isRule(line) || /^ {0,3}>/.test(line) || listMarker(line)) return true;
  const header = tableCells(line);
  return header !== null && isTableDelimiter(tableCells(lines[index + 1] ?? ""));
}

function inlineGroup(text: string, key: string, plain: boolean, streaming: boolean): SafeInlineGroup {
  return Object.freeze({ key, inlines: inlineNodes(text, key, plain, streaming) });
}

function markdownNodes(
  text: string,
  keyBase: string,
  plain: boolean,
  streaming: boolean,
  baseIndex = 0,
  starts: number[] = [],
): readonly SafeContentNode[] {
  if (plain) {
    return text.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          key: stableKey(keyBase, "paragraph", "0"),
          kind: "paragraph" as const,
          inlines: inlineNodes(text, stableKey(keyBase, "paragraph", "0"), true, streaming),
        })]);
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const closingFenceIndexes = nextClosingFenceIndexes(lines);
  const nodes: SafeContentNode[] = [];
  let index = 0;
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) { offsets.push(offset); offset += line.length + 1; }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    starts.push(offsets[index]!);
    const language = fenceLanguage(line);
    const closingFence = language === undefined ? -1 :
      (closingFenceIndexes[index] === -1 && streaming ? lines.length : (closingFenceIndexes[index] ?? -1));
    if (language !== undefined && closingFence !== -1) {
      const key = stableKey(keyBase, "code", String(baseIndex + nodes.length));
      nodes.push(Object.freeze({
        key,
        kind: "code" as const,
        language,
        text: lines.slice(index + 1, closingFence).join("\n"),
      }));
      index = closingFence + 1;
      continue;
    }

    const title = heading(line);
    const underline = lines[index + 1]?.match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (title || (underline && !listMarker(line) && !/^ {0,3}>/.test(line))) {
      const key = stableKey(keyBase, "heading", String(baseIndex + nodes.length));
      nodes.push(Object.freeze({
        key,
        kind: "heading" as const,
        level: title?.level ?? (underline![1]![0] === "=" ? 1 : 2),
        inlines: inlineNodes(title?.text ?? line.trim(), key, false, streaming),
      }));
      index += title ? 1 : 2;
      continue;
    }

    if (isRule(line)) {
      nodes.push(Object.freeze({ key: stableKey(keyBase, "rule", String(baseIndex + nodes.length)), kind: "rule" as const }));
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^ {0,3}>[ \t]?/, ""));
        index += 1;
      }
      nodes.push(Object.freeze({
        key: stableKey(keyBase, "quote", String(baseIndex + nodes.length)),
        kind: "quote" as const,
        text: quoted.join("\n"),
      }));
      continue;
    }

    const headerCells = tableCells(line);
    const delimiterCells = tableCells(lines[index + 1] ?? "");
    if (
      headerCells !== null &&
      isTableDelimiter(delimiterCells) &&
      headerCells.length === delimiterCells.length
    ) {
      const key = stableKey(keyBase, "table", String(baseIndex + nodes.length));
      const headers = Object.freeze(headerCells.map((cell, cellIndex) =>
        inlineGroup(cell, stableKey(key, "header", String(cellIndex)), false, streaming)));
      const rows: (readonly SafeInlineGroup[])[] = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length) {
        const cells = tableCells(lines[rowIndex] ?? "");
        if (cells === null || cells.length !== headers.length) break;
        rows.push(Object.freeze(cells.map((cell, cellIndex) =>
          inlineGroup(
            cell,
            stableKey(key, "row", String(rows.length), String(cellIndex)),
            false, streaming,
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

    const firstMarker = listMarker(line);
    if (firstMarker) {
      const key = stableKey(keyBase, "list", String(baseIndex + nodes.length));
      const items: { key: string; text: string }[] = [];
      while (index < lines.length) {
        const marker = listMarker(lines[index]!);
        if (!marker || marker.ordered !== firstMarker.ordered || marker.indent !== firstMarker.indent || isRule(lines[index]!)) break;
        const body = [marker.text];
        index += 1;
        while (index < lines.length) {
          const nextLine = lines[index]!;
          if (nextLine.trim().length === 0) {
            let next = index + 1;
            while (next < lines.length && lines[next]!.trim().length === 0) next += 1;
            const following = lines[next] ?? "";
            if (following.startsWith(" ".repeat(marker.width))) {
              body.push("");
              index = next;
              continue;
            }
            const nextMarker = listMarker(following);
            if (nextMarker?.indent === firstMarker.indent && nextMarker.ordered === firstMarker.ordered) index = next;
            break;
          }
          if (nextLine.startsWith(" ".repeat(marker.width))) {
            body.push(nextLine.slice(marker.width));
          } else if (!startsBlock(lines, closingFenceIndexes, index, streaming)) {
            body.push(nextLine);
          } else break;
          index += 1;
        }
        items.push(Object.freeze({ key: stableKey(key, "item", String(items.length)), text: body.join("\n") }));
      }
      nodes.push(Object.freeze({
        key,
        kind: "list" as const,
        ordered: firstMarker.ordered,
        start: firstMarker.start,
        items: Object.freeze(items),
      }));
      continue;
    }

    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, closingFenceIndexes, index, streaming)) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const key = stableKey(keyBase, "paragraph", String(baseIndex + nodes.length));
    const literalFallback = paragraphLines.some((paragraphLine) =>
      fenceLanguage(paragraphLine) !== undefined);
    const paragraphText = literalFallback ? paragraphLines.join("\n") : paragraphLines
      .map((paragraphLine, lineIndex) => {
        const hardBreak = /(?: {2,}|\\)$/.test(paragraphLine);
        const content = hardBreak ? paragraphLine.replace(/(?: {2,}|\\)$/, "") : paragraphLine;
        return content + (lineIndex < paragraphLines.length - 1 ? hardBreak ? "\n" : " " : "");
      }).join("");
    nodes.push(Object.freeze({
      key,
      kind: "paragraph" as const,
      inlines: inlineNodes(paragraphText, key, literalFallback, streaming),
    }));
  }

  return Object.freeze(nodes);
}


export interface ContentRange { readonly startOffset: number; readonly endOffset: number }
export type ChatInlineNode = SafeInlineNode & ContentRange;
type ChatInlineGroup = Omit<SafeInlineGroup, "inlines"> & ContentRange & { readonly inlines: readonly ChatInlineNode[] };
export type ChatContentNode = ContentRange & (
  | (Omit<Extract<SafeContentNode, { kind: "heading" }>, "inlines"> & { readonly inlines: readonly ChatInlineNode[] })
  | (Omit<Extract<SafeContentNode, { kind: "paragraph" }>, "inlines"> & { readonly inlines: readonly ChatInlineNode[] })
  | (Extract<SafeContentNode, { kind: "quote" }> & { readonly children: readonly ChatContentNode[] })
  | (Omit<Extract<SafeContentNode, { kind: "list" }>, "items"> & { readonly items: readonly (ContentRange & { key: string; children: readonly ChatContentNode[] })[] })
  | (Omit<Extract<SafeContentNode, { kind: "table" }>, "headers" | "rows"> & { readonly headers: readonly ChatInlineGroup[]; readonly rows: readonly (readonly ChatInlineGroup[])[] })
  | Exclude<SafeContentNode, { kind: "paragraph" | "heading" | "quote" | "list" | "table" }>
);
interface ParsedMarkdown { text: string; plain: boolean; streaming: boolean; nodes: readonly SafeContentNode[]; starts: number[] }
interface IndexedMarkdown { startOffset: number; streaming: boolean; node: ChatContentNode; text: string }
export interface ChatMarkdownDocument { readonly nodes: readonly ChatContentNode[]; readonly text: string }

/** Component-local cache: completed blocks retain identity; only the last open
 * block is reparsed on append. Replacements and mode changes use the full parser. */
export function createChatMarkdownParser() {
  let cache = new Map<string, ParsedMarkdown>();
  const indexed = new WeakMap<SafeContentNode, IndexedMarkdown>();
  return (blocks: readonly ConversationTimelineContentBlock[], mode: "rich" | "plain", streaming: boolean): ChatMarkdownDocument => {
    const nextCache = new Map<string, ParsedMarkdown>();
    function parse(text: string, key: string, plain: boolean): readonly SafeContentNode[] {
      if (!plain) text = text.replace(/\r\n?/g, "\n");
      const prior = cache.get(key);
      if (prior && prior.text === text && prior.plain === plain && prior.streaming === streaming) {
        nextCache.set(key, prior); return prior.nodes;
      }
      const append = prior && streaming && !plain && !prior.plain && prior.streaming === streaming && text.startsWith(prior.text);
      // A temporarily incomplete row can appear as a paragraph after a table.
      // Rewind its preceding container as well so it can absorb the finished row.
      const preceding = prior?.nodes[prior.nodes.length - 2]?.kind;
      const rewind = preceding && ["table", "list", "quote"].includes(preceding) ? 2 : 1;
      const kept = append ? Math.max(0, prior.nodes.length - rewind) : 0;
      const startOffset = kept ? prior!.starts[kept]! : 0;
      const starts: number[] = [];
      const nodes = [...(kept ? prior!.nodes.slice(0, kept) : []), ...markdownNodes(text.slice(startOffset), key, plain, streaming, kept, starts)];
      nextCache.set(key, { text, plain, streaming, nodes, starts: [...(kept ? prior!.starts.slice(0, kept) : []), ...starts.map(offset => offset + startOffset)] });
      return nodes;
    }
    function indexNodes(nodes: readonly SafeContentNode[], startOffset: number): { nodes: readonly ChatContentNode[]; text: string } {
      let offset = startOffset;
      const texts: string[] = [];
      const result = nodes.map(node => {
        const previous = indexed.get(node);
        if (previous?.startOffset === offset && previous.streaming === streaming) {
          offset += previous.text.length; texts.push(previous.text); return previous.node;
        }
        const nodeStart = offset;
        let text = "";
        function consume(value: string): ContentRange {
          const startOffset = offset; text += value; offset += value.length; return { startOffset, endOffset: offset };
        }
        function inlines(values: readonly SafeInlineNode[]): readonly ChatInlineNode[] {
          return values.map(value => {
            const display = value.text;
            return { ...value, text: display, ...consume(display) };
          });
        }
        function children(source: string, key: string) {
          const result = indexNodes(parse(source, key, false), offset);
          consume(result.text); return result.nodes;
        }
        function group(value: SafeInlineGroup): ChatInlineGroup {
          const startOffset = offset; const values = inlines(value.inlines);
          return { ...value, startOffset, endOffset: offset, inlines: values };
        }
        let output: ChatContentNode;
        if (node.kind === "paragraph" || node.kind === "heading") output = { ...node, startOffset: nodeStart, endOffset: 0, inlines: inlines(node.inlines) };
        else if (node.kind === "quote") output = { ...node, startOffset: nodeStart, endOffset: 0, children: children(node.text, node.key) };
        else if (node.kind === "list") output = { ...node, startOffset: nodeStart, endOffset: 0, items: node.items.map(item => {
          const startOffset = offset; const values = children(item.text, item.key); return { key: item.key, startOffset, endOffset: offset, children: values };
        }) };
        else if (node.kind === "table") output = { ...node, startOffset: nodeStart, endOffset: 0, headers: node.headers.map(group), rows: node.rows.map(row => row.map(group)) };
        else { if (node.kind === "code") consume(node.text); output = { ...node, startOffset: nodeStart, endOffset: 0 }; }
        output = { ...output, endOffset: offset };
        indexed.set(node, { startOffset: nodeStart, streaming, node: output, text });
        texts.push(text); return output;
      });
      return { nodes: result, text: texts.join("") };
    }
    const nodes: SafeContentNode[] = [];
    for (const block of blocks) {
      if (block.type === "text") nodes.push(...parse(block.text, block.identity, mode === "plain"));
      else if (block.type === "code") nodes.push({ key: block.identity, kind: "code", language: safeLanguage(block.language), text: block.text });
      else if (block.type === "artifact_reference") nodes.push({ key: block.identity, kind: block.type, block });
      else if (block.type === "attachment_reference") nodes.push({ key: block.identity, kind: block.type, block });
      else nodes.push({ key: block.identity, kind: "unknown", code: "unsupported_content" });
    }
    const result = indexNodes(nodes, 0);
    cache = nextCache;
    return result;
  };
}
