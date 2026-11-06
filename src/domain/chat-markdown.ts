import { bareFileAt, markdownFileDestination, standaloneFileLine, possibleRepeatedPath, isPendingFileLine, type MessageFileReference } from "./message-file-reference";
import type { ConversationTimelineArtifactReferenceContentBlock, ConversationTimelineAttachmentReferenceContentBlock, ConversationTimelineContentBlock } from "./conversation-timeline";

type SafeInlineNode = Readonly<{
  key: string;
  kind: "text" | "strong" | "emphasis" | "strikethrough" | "inline_code" | "inert_link" | "file_link";
  text: string;
  destination: string | null;
  file?: MessageFileReference;
}>;

type SafeInlineGroup = Readonly<{
  key: string;
  inlines: readonly SafeInlineNode[];
}>;

type SafeContentNode =
  | Readonly<{
      key: string;
      kind: "paragraph";
      pathLine?: string;
      possibleRepeat?: MessageFileReference;
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

function inlineNodes(source: string, keyBase: string, plain: boolean, streaming: boolean, fileLinks: boolean): readonly SafeInlineNode[] {
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
    file?: MessageFileReference,
  ): void {
    if (text.length === 0) return;
    nodes.push(Object.freeze({
      key: stableKey(keyBase, kind, String(nodes.length)),
      kind,
      text,
      destination,
      ...(file && { file }),
    }));
  }

  function appendFile(file: MessageFileReference): void {
    append("file_link", `《${file.name}》`, file.raw, file);
  }

  function appendFormatted(kind: "strong" | "emphasis" | "strikethrough", value: string): void {
    // A styled run can contain a file link. Keep the surrounding emphasis
    // while giving the link its own interactive node and reveal offsets.
    if (fileLinks && (value.includes("[") || value.includes("/") || value.includes("`"))) {
      const parts = inlineNodes(value, keyBase, false, streaming, fileLinks);
      if (parts.some(part => part.file || part.kind === "inert_link")) {
        for (const part of parts) append(part.kind === "text" ? kind : part.kind, part.text, part.destination, part.file);
        return;
      }
    }
    append(kind, value);
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
      let count = 1;
      while (source[cursor + count] === "`") count++;
      const marker = "`".repeat(count);
      let closing = source.indexOf(marker, cursor + count);
      while (closing !== -1 && source[closing + count] === "`") {
        while (source[closing] === "`") closing++;
        closing = source.indexOf(marker, closing);
      }
      if (closing >= cursor + count) {
        flushPlain(cursor);
        const value = source.slice(cursor + count, closing);
        const file = fileLinks && count === 1 && standaloneFileLine(value);
        if (file && file.raw === value) appendFile(file);
        else append("inline_code", value);
        plainStart = cursor = closing + count;
        continue;
      }
      if (streaming) {
        flushPlain(cursor);
        const suffix = source.slice(cursor + count);
        if (!fileLinks || count !== 1 || !/^(?:\/|file:)/iu.test(suffix)) append("inline_code", suffix);
        plainStart = cursor = source.length;
        continue;
      }
      cursor += count;
      continue;
    }

    const delimiter = source.startsWith("**", cursor) ? "**"
      : source.startsWith("__", cursor) ? "__"
      : source.startsWith("~~", cursor) ? "~~" : null;
    if (delimiter) {
      const closing = source.indexOf(delimiter, cursor + 2);
      if (closing > cursor + 2) {
        flushPlain(cursor);
        appendFormatted(delimiter === "~~" ? "strikethrough" : "strong", source.slice(cursor + 2, closing));
        cursor = closing + 2;
        plainStart = cursor;
        continue;
      }
      // A live suffix may not have received its closing marker yet. Keep the
      // same formatted node as it arrives; settled/malformed text keeps the old fallback.
      if (streaming && closing === -1) {
        flushPlain(cursor);
        const suffix = source.slice(cursor + 2);
        appendFormatted(delimiter === "~~" ? "strikethrough" : "strong",
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
        appendFormatted("emphasis", source.slice(cursor + 1, closing));
        cursor = closing + 1;
        plainStart = cursor;
        continue;
      }
    }

    const imageLink = fileLinks && source.startsWith("![", cursor);
    if (imageLink || (source[cursor] === "[" && source[cursor - 1] !== "!")) {
      const labelStart = cursor + (imageLink ? 2 : 1);
      let brackets = 1;
      let end = labelStart;
      while (end < source.length) {
        const ch = source[end];
        if (ch === "\\") end++;
        else if (ch === "[") brackets++;
        else if (ch === "]" && --brackets === 0) break;
        end++;
      }
      const label = source.slice(labelStart, end);
      const incomplete = end >= source.length || (end === source.length - 1 && streaming);
      if (incomplete) {
        if (streaming) {
          flushPlain(cursor);
          append("inert_link", label);
          plainStart = source.length;
        }
        break;
      }
      if (source[end + 1] === "(") {
        const start = end + 2;
        const closing = destinationEnd(source, start);
        if (closing < 0) {
          if (streaming) {
            flushPlain(cursor);
            append("inert_link", label);
            plainStart = source.length;
          }
          break;
        }
        const destination = source.slice(start, closing);
        const file = fileLinks && markdownFileDestination(destination);
        flushPlain(cursor);
        if (file) appendFile(file);
        else if (imageLink || !label || !destination) append("text", source.slice(cursor, closing + 1));
        else append("inert_link", label, destination);
        plainStart = cursor = closing + 1;
        continue;
      }
    }

    if (fileLinks && (source[cursor] === "/" || (source[cursor] === "f" || source[cursor] === "F") && source.slice(cursor, cursor + 5).toLowerCase() === "file:")) {
      const file = bareFileAt(source, cursor);
      if (file) {
        flushPlain(cursor);
        appendFile(file);
        cursor += file.raw.length;
        plainStart = cursor;
        continue;
      }
    }

    cursor += 1;
  }

  flushPlain(source.length);
  // The link already supplies book-title marks. Consume a pair written around
  // it by the author, while keeping punctuation and unrelated prose intact.
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i]!.file) continue;
    const left = nodes[i - 1], right = nodes[i + 1];
    if (left?.kind === "text" && left.text.endsWith("《")) nodes[i - 1] = { ...left, text: left.text.slice(0, -1) };
    if (right?.kind === "text" && right.text.startsWith("》")) nodes[i + 1] = { ...right, text: right.text.slice(1) };
  }
  return Object.freeze(nodes.filter(node => node.text.length > 0));
}

/** Destinations can contain balanced parentheses, angle-quoted paths, and a title. */
function destinationEnd(source: string, start: number): number {
  let depth = 1;
  let quote = source[start] === "<" ? ">" : "";
  for (let i = start + (quote ? 1 : 0); i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if ((ch === '"' || ch === "'") && /\s/u.test(source[i - 1] ?? "")) quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i;
  }
  return -1;
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

function fence(line: string) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match || (match[1]![0] === "`" && match[2]!.includes("`"))) return null;
  return { marker: match[1]!, info: match[2]!.trim() };
}

function nextClosingFenceIndexes(lines: readonly string[]): readonly number[] {
  const indexes = new Array<number>(lines.length).fill(-1);
  let open: { marker: string; index: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const next = fence(lines[i]!);
    if (!next) continue;
    if (!open) open = { marker: next.marker, index: i };
    else if (!next.info && next.marker.startsWith(open.marker)) {
      indexes[open.index] = i;
      open = null;
    }
  }
  return indexes;
}

function startsBlock(
  lines: readonly string[],
  closingFenceIndexes: readonly number[],
  index: number,
  streaming: boolean,
  fileLinks: boolean,
): boolean {
  const line = lines[index] ?? "";
  if (line.trim().length === 0 || (fileLinks && (standaloneFileLine(line) || possibleRepeatedPath(line) ||
      streaming && index === lines.length - 1 && isPendingFileLine(line)))) return true;
  if (fence(line) !== null && (closingFenceIndexes[index] !== -1 || streaming)) return true;
  if (heading(line) || isRule(line) || /^ {0,3}>/.test(line) || listMarker(line)) return true;
  const header = tableCells(line);
  return header !== null && isTableDelimiter(tableCells(lines[index + 1] ?? ""));
}

function inlineGroup(text: string, key: string, plain: boolean, streaming: boolean, fileLinks: boolean): SafeInlineGroup {
  return Object.freeze({ key, inlines: inlineNodes(text, key, plain, streaming, fileLinks) });
}

function markdownNodes(
  text: string,
  keyBase: string,
  plain: boolean,
  streaming: boolean,
  fileLinks: boolean,
  baseIndex = 0,
  starts: number[] = [],
): readonly SafeContentNode[] {
  if (plain) {
    return text.length === 0
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          key: stableKey(keyBase, "paragraph", "0"),
          kind: "paragraph" as const,
          inlines: inlineNodes(text, stableKey(keyBase, "paragraph", "0"), true, streaming, false),
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
    const openingFence = fence(line);
    const closingFence = !openingFence ? -1 :
      (closingFenceIndexes[index] === -1 && streaming ? lines.length : (closingFenceIndexes[index] ?? -1));
    if (openingFence && closingFence !== -1) {
      const key = stableKey(keyBase, "code", String(baseIndex + nodes.length));
      nodes.push(Object.freeze({
        key,
        kind: "code" as const,
        language: safeLanguage(openingFence.info),
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
        inlines: inlineNodes(title?.text ?? line.trim(), key, false, streaming, fileLinks),
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
        inlineGroup(cell, stableKey(key, "header", String(cellIndex)), false, streaming, fileLinks)));
      const rows: (readonly SafeInlineGroup[])[] = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length) {
        const cells = tableCells(lines[rowIndex] ?? "");
        if (cells === null || cells.length !== headers.length) break;
        rows.push(Object.freeze(cells.map((cell, cellIndex) =>
          inlineGroup(
            cell,
            stableKey(key, "row", String(rows.length), String(cellIndex)),
            false, streaming, fileLinks,
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
          } else if (!startsBlock(lines, closingFenceIndexes, index, streaming, fileLinks)) {
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

    if (fileLinks && streaming && index === lines.length - 1 && isPendingFileLine(line)) {
      starts.pop();
      break;
    }
    const pathLine = fileLinks && standaloneFileLine(line);
    if (pathLine) {
      const key = stableKey(keyBase, "paragraph", String(baseIndex + nodes.length));
      nodes.push({ key, kind: "paragraph", pathLine: pathLine.path, inlines: [{
        key: stableKey(key, "file_link", "0"), kind: "file_link", text: `《${pathLine.name}》`,
        destination: pathLine.raw, file: pathLine,
      }] });
      index++;
      continue;
    }
    const possibleRepeat = fileLinks && possibleRepeatedPath(line);
    if (possibleRepeat) {
      const key = stableKey(keyBase, "paragraph", String(baseIndex + nodes.length));
      nodes.push({key, kind: "paragraph", possibleRepeat, inlines: inlineNodes(line.trim(),key,false,streaming,fileLinks)});
      index++;
      continue;
    }
    const paragraphLines: string[] = [line];
    index += 1;
    while (index < lines.length && !startsBlock(lines, closingFenceIndexes, index, streaming, fileLinks)) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    const key = stableKey(keyBase, "paragraph", String(baseIndex + nodes.length));
    const literalFallback = paragraphLines.some((paragraphLine) =>
      fence(paragraphLine) !== null);
    const paragraphText = literalFallback ? paragraphLines.join("\n") : paragraphLines
      .map((paragraphLine, lineIndex) => {
        const hardBreak = /(?: {2,}|\\)$/.test(paragraphLine);
        const content = hardBreak ? paragraphLine.replace(/(?: {2,}|\\)$/, "") : paragraphLine;
        return content + (lineIndex < paragraphLines.length - 1 ? hardBreak ? "\n" : " " : "");
      }).join("");
    nodes.push(Object.freeze({
      key,
      kind: "paragraph" as const,
      inlines: inlineNodes(paragraphText, key, literalFallback, streaming, fileLinks),
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
export interface ChatMarkdownDocument { readonly nodes: readonly ChatContentNode[]; readonly text: string; readonly relativeHint?: MessageFileReference }

/** Component-local cache: completed blocks retain identity; only the last open
 * block is reparsed on append. Replacements and mode changes use the full parser. */
export function createChatMarkdownParser(fileLinks = false, workspace: string | null = null) {
  let cache = new Map<string, ParsedMarkdown>();
  const indexed = new WeakMap<SafeContentNode, IndexedMarkdown>();
  return (blocks: readonly ConversationTimelineContentBlock[], mode: "rich" | "plain", streaming: boolean): ChatMarkdownDocument => {
    const nextCache = new Map<string, ParsedMarkdown>();
    function parse(text: string, key: string, plain: boolean): readonly SafeContentNode[] {
      if (!plain) text = text.replace(/\r\n?/g, "\n");
      const prior = nextCache.get(key) ?? cache.get(key);
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
      const nodes = [...(kept ? prior!.nodes.slice(0, kept) : []), ...markdownNodes(text.slice(startOffset), key, plain, streaming, fileLinks, kept, starts)];
      nextCache.set(key, { text, plain, streaming, nodes, starts: [...(kept ? prior!.starts.slice(0, kept) : []), ...starts.map(offset => offset + startOffset)] });
      return nodes;
    }
    function indexNodes(nodes: readonly SafeContentNode[], startOffset: number): { nodes: readonly ChatContentNode[]; text: string } {
      let offset = startOffset;
      const texts: string[] = [];
      const result: ChatContentNode[] = [];
      for (const node of nodes) {
        if (hiddenPaths.has(node.key)) continue;
        const cacheable = !hiddenPaths.size || (node.kind !== "list" && node.kind !== "quote");
        const previous = cacheable ? indexed.get(node) : undefined;
        if (previous?.startOffset === offset && previous.streaming === streaming) {
          offset += previous.text.length; texts.push(previous.text); result.push(previous.node);
          continue;
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
          const original = parse(source, key, false);
          const child = indexNodes(original, offset);
          consume(child.text);
          return original.length && !child.nodes.length ? null : child.nodes;
        }
        function group(value: SafeInlineGroup): ChatInlineGroup {
          const startOffset = offset; const values = inlines(value.inlines);
          return { ...value, startOffset, endOffset: offset, inlines: values };
        }
        let output: ChatContentNode;
        if (node.kind === "paragraph" || node.kind === "heading") output = { ...node, startOffset: nodeStart, endOffset: 0, inlines: inlines(node.inlines) };
        else if (node.kind === "quote") {
          const values = children(node.text, node.key);
          if (!values) continue;
          output = { ...node, startOffset: nodeStart, endOffset: offset, children: values };
        } else if (node.kind === "list") {
          const items = node.items.flatMap(item => {
            const startOffset = offset;
            const values = children(item.text, item.key);
            return values ? [{ key: item.key, startOffset, endOffset: offset, children: values }] : [];
          });
          if (!items.length) continue;
          output = { ...node, startOffset: nodeStart, endOffset: offset, items };
        }
        else if (node.kind === "table") output = { ...node, startOffset: nodeStart, endOffset: 0, headers: node.headers.map(group), rows: node.rows.map(row => row.map(group)) };
        else { if (node.kind === "code") consume(node.text); output = { ...node, startOffset: nodeStart, endOffset: 0 }; }
        output = { ...output, endOffset: offset };
        if (cacheable) indexed.set(node, { startOffset: nodeStart, streaming, node: output, text });
        texts.push(text);
        result.push(output);
      }
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
    // Resolve duplicates across all blocks and nested containers in this one
    // answer before assigning reveal offsets. Keep named links in real prose.
    const hiddenPaths = new Set<string>();
    let relativeHint: MessageFileReference | undefined;
    if (fileLinks && mode === "rich") {
      const contextual = new Set<string>();
      const standalone: { key: string; path: string; pathLine: boolean }[] = [];
      const possibleRepeats: {key: string; path: string}[] = [];
      let relative: MessageFileReference | undefined;
      let hasAbsolute = false;
      function identity(file: MessageFileReference) {
        if (file.path.startsWith("/")) hasAbsolute = true;
        else relative ??= file;
        return !workspace || file.path.startsWith("/") ? file.path : workspace + "/" + file.path;
      }
      function remember(inlines: readonly SafeInlineNode[]) {
        for (const link of inlines) if (link.file) contextual.add(identity(link.file));
      }
      function visit(node: SafeContentNode) {
        if (node.kind === "paragraph" && node.possibleRepeat) {
          possibleRepeats.push({ key: node.key, path: identity(node.possibleRepeat) });
        } else if (node.kind === "paragraph" && node.inlines.length === 1 && node.inlines[0]!.file) {
          standalone.push({key: node.key, path: identity(node.inlines[0]!.file), pathLine: Boolean(node.pathLine)});
        } else if (node.kind === "paragraph" || node.kind === "heading") remember(node.inlines);
        else if (node.kind === "table") for (const cell of [...node.headers, ...node.rows.flat()]) remember(cell.inlines);
        else if (node.kind === "list") for (const item of node.items) parse(item.text, item.key, false).forEach(visit);
        else if (node.kind === "quote") parse(node.text, node.key, false).forEach(visit);
      }
      nodes.forEach(visit);
      // Prefer a named link to its redundant "路径" line regardless of source order.
      for (const item of standalone.sort((a,b) => Number(a.pathLine) - Number(b.pathLine))) {
        if (contextual.has(item.path)) hiddenPaths.add(item.key);
        else contextual.add(item.path);
      }
      for (const item of possibleRepeats) if (contextual.has(item.path)) hiddenPaths.add(item.key);
      if (!workspace && hasAbsolute && (standalone.length || possibleRepeats.length)) relativeHint = relative;
    }
    const result = indexNodes(nodes, 0);
    cache = nextCache;
    return relativeHint ? { ...result, relativeHint } : result;
  };
}
