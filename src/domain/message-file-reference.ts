/** Markdown destinations use URI escaping. Literal filesystem paths keep their percent signs. */
export function messageFileReference(raw: string, markdown = false) {
  if (!raw || raw.length > 4096) return null;
  const fileUrl = /^file:\/\/(?:localhost)?\//iu.test(raw);
  let path = fileUrl ? raw.replace(/^file:\/\/(?:localhost)?/iu, "") : raw;
  const absolute = path.startsWith("/");
  if (!absolute && (!markdown || path.startsWith("~") || path.split("/", 1)[0]!.includes(":"))) return null;
  if (markdown || fileUrl) {
    if (/[?#]/u.test(path) || /%(?:2f|5c)/iu.test(path)) return null;
    try { path = decodeURIComponent(path); } catch { return null; }
  }
  if (!absolute) path = path.replace(/^\.\//u, "");
  if (!path || /[\p{Cc}\\]/u.test(path)) return null;
  const parts = (absolute ? path.slice(1) : path).split("/");
  if (parts.some(part => !part || part === "." || part === "..")) return null;
  const name = parts[parts.length - 1]!;
  if (!absolute && !/\.[\p{L}\p{N}]{1,16}$/u.test(name)) return null;
  return { raw, path, name };
}
export type MessageFileReference = NonNullable<ReturnType<typeof messageFileReference>>;

const pathLabel = /^(?:(?:文件|保存|输出|完整)?路径|path)\s*[：:]\s*/iu;
const extension = /\.[\p{L}\p{N}]{1,16}$/u;

/** Whitespace is unambiguous in a Markdown destination and in an explicitly
 * labelled path. An ordinary code span can just as easily be a shell command. */
export function standaloneFileLine(line: string) {
  const text = line.trim();
  const labelled = pathLabel.test(text);
  let value = text.replace(pathLabel, "");
  if (value.startsWith("`") && value.endsWith("`")) value = value.slice(1, -1);
  if (!extension.test(value) || value.includes("`") || (!labelled && /\s/u.test(value))) return null;
  return messageFileReference(value);
}

/** A standalone code span with spaces might be a command. It may be folded
 * only if an independently recognized reference proves the same complete path. */
export function possibleRepeatedPath(line: string) {
  const text = line.trim();
  if (!text.startsWith("`") || !text.endsWith("`") || !/\s/u.test(text)) return null;
  const raw = text.slice(1, -1);
  return !raw.includes("`") && extension.test(raw) ? messageFileReference(raw) : null;
}

export function isPendingFileLine(line: string): boolean {
  const value = line.trim().replace(pathLabel, "");
  return /^`?(?:\/|file:)/iu.test(value) && !value.endsWith("`");
}

const bareStart = /[\s（(【《“‘"'：，、|]/u;
// Consume a complete spelling before testing its extension. In particular,
// square brackets inside a filename must never authorize a shorter prefix.
const bareToken = /(?:file:\/\/(?:localhost)?\/|\/(?!\/))[^\s<>`"'“”‘’《》【】（），。；、！？：|]+/iyu;
export function bareFileAt(source: string, index: number) {
  if (index && !bareStart.test(source[index - 1]!)) return null;
  bareToken.lastIndex = index;
  const token = bareToken.exec(source)?.[0];
  if (!token) return null;
  let raw = token.replace(/[.,;:!?]+$/u, "");
  if (source[index - 1] === "(" && raw.endsWith(")")) raw = raw.slice(0, -1);
  return extension.test(raw) ? messageFileReference(raw) : null;
}

/** File producers also emit unescaped spaces in destinations. A Markdown
 * title, when present, is separated from the pathname before decoding it. */
export function markdownFileDestination(destination: string) {
  const value = destination.trim();
  const titled = /^(.*?)[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\))$/u.exec(value);
  const raw = (titled?.[1] ?? value).trim();
  return messageFileReference(raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw, true);
}
