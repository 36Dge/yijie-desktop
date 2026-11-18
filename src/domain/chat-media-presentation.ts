import type { ArtifactProjection } from "./chat-artifact";
import type { ConversationTimelineArtifactReferenceContentBlock, ConversationTimelineItemViewModel, ConversationTimelineViewModel } from "./conversation-timeline";

const MEDIA_EXTENSION = /\.(?:png|jpe?g|webp|gif|svg|avif|mp4|webm|mov|mkv)$/i;
const GENERIC_MEDIA_NAME = /^(?:(?:generated|output)[-_ ]?(?:image|video)(?:[-_ ]?\d+)?|(?:image|video)(?:[-_ ]?\d+)?|生成的?(?:图片|图像|视频)|未命名(?:图片|视频)|图片|图像|视频)$/i;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"],
  "image/gif": ["gif"], "image/svg+xml": ["svg"], "image/avif": ["avif"],
  "video/mp4": ["mp4"], "video/webm": ["webm"], "video/quicktime": ["mov"], "video/x-matroska": ["mkv"],
};

function cleanName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, " ").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").replace(/^[.\s-]+|[.\s-]+$/g, "");
}

/** A stable, extractive label from the user's own request; no extra model call. */
export function mediaRequestTitle(request: string): string | null {
  const text = request.replace(UUID, "").replace(/--(?:ar|ratio|aspect-ratio)\s+\d+(?::\d+)?/gi, "")
    .replace(/\b\d+\s*[:：]\s*\d+\b/g, "").replace(/[`*_#]/g, "").trim();
  if (!text || /^(?:请|帮我)?(?:再来|再生成|再制作|重新生成|重新制作|重试|再试|继续)(?:一次|一张|一段|一个|一幅)?(?:图片|视频)?(?:吧|一下)?[。.!！]?$/u.test(text)) return null;
  const clauses = text.split(/[，,。\n！？!?；;：:]+/u).map(value => value.trim()
    .replace(/^(?:请(?:帮我)?|麻烦(?:帮我)?|帮我|帮忙)\s*/u, "")
    .replace(/^(?:生成|制作|创建|设计|绘制|画)(?:一[张段幅个])?(?:(?:图片|图像|视频|短片)(?:关于|有关|展示|的)?)?\s*/u, "")
    .replace(/^(?:please\s+)?(?:create|generate|make|draw|design)\s+(?:(?:an?|one)\s+)?(?:(?:image|picture|video|clip)\s+(?:of|showing|about)\s+)?/i, "")
    .replace(/^一[瓶只杯个张段幅枚]\s*/u, "").replace(/^的\s*/u, ""))
    .filter(value => value && !GENERIC_MEDIA_NAME.test(value) && !/^(?:参考|根据|用)?(?:这张图|这张图片|参考图片|参考图|附件)|^(?:产物|图片|视频)\s*(?:ID|编号)|^[\d\s./-]+$/iu.test(value));
  const subject = clauses[0];
  if (!subject) return null;
  const detail = clauses.slice(1).find(value => /摄影|插画|海报|动画|展示|宣传|短片|特写|镜头|风格/u.test(value) && Array.from(value).length <= 18 && !subject.includes(value));
  const limit = /\p{Script=Han}/u.test(subject) ? 32 : 64;
  const name = cleanName([subject, detail].filter(Boolean).join("-"));
  return Array.from(name).slice(0, limit).join("") || null;
}

export function mediaDisplayName(artifact: Pick<ArtifactProjection, "kind" | "displayName" | "mediaType">, request = ""): string {
  const original = (artifact.displayName ?? "").trim();
  const suppliedExtension = original.match(MEDIA_EXTENSION)?.[0].slice(1).toLowerCase();
  const stem = cleanName(original.replace(MEDIA_EXTENSION, "").replace(UUID, ""));
  const title = stem && !GENERIC_MEDIA_NAME.test(stem) && !/^(?:artifact|generated|output)$/i.test(stem) ? stem
    : mediaRequestTitle(request) ?? (artifact.kind === "video" ? "视频" : "图片");
  const supported = EXTENSIONS[artifact.mediaType ?? ""];
  const extension = supported ? suppliedExtension && supported.includes(suppliedExtension) ? suppliedExtension : supported[0] : suppliedExtension;
  return extension ? `${title}.${extension}` : title;
}

/** Remove only metadata naming known media artifacts, never unrelated UUIDs. */
export function hideMediaIdMetadata(text: string, ids: readonly string[]): string {
  if (!ids.length) return text;
  const alternatives = ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const field = new RegExp("(?:[（(]\\s*)?(?:\\*\\*)?[`\"']?(?:(?:图片|图像|视频)?产物|图片|图像|视频|artifact|image|video)[\\s_-]*(?:id|编号)[`\"']?(?:\\*\\*)?\\s*[:：=](?:\\*\\*)?\\s*[`\"']?(?:" + alternatives + ")(?![a-f0-9-])[`\"']?(?:\\*\\*)?(?:\\s*[）)])?", "gi");
  function stripLine(line: string): string | null {
    const next = line.replace(field, "");
    if (next !== line) {
      return /^[\s`*_+\-。.,;；:：()（）{}[\]"']*$/.test(next) ? null : next;
    }
    const plain = line.replace(/[`*_]/g, "").replace(/^\s*[-+]\s*/, "").trim();
    if (ids.some(id => id.toLowerCase() === plain.toLowerCase())) return null;
    const pending = plain.match(/^(?:(?:图片|图像|视频)?产物|图片|图像|视频|artifact|image|video)[\s_-]*(?:id|编号)\s*[:：=]\s*([a-f0-9-]*)$/i);
    if (pending && (!pending[1] || ids.some(id => id.toLowerCase().startsWith(pending[1]!.toLowerCase())))) return null;
    return line;
  }
  let removed = false;
  const lines = text.split("\n"), output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      let end = index + 1;
      for (; end < lines.length; end++) {
        const closing = lines[end]!.match(/^ {0,3}([`~]+)\s*$/);
        if (closing && closing[1]!.length >= fence[1]!.length && [...closing[1]!].every(char => char === fence[1]![0])) break;
      }
      const body = lines.slice(index + 1, end), cleaned = body.map(stripLine);
      if (cleaned.every(value => !value?.trim()) && cleaned.some((value, i) => value !== body[i])) removed = true;
      else output.push(...lines.slice(index, Math.min(end + 1, lines.length)));
      index = end;
      continue;
    }
    const next = stripLine(line);
    if (next !== line) removed = true;
    if (next !== null) output.push(next);
  }
  return removed ? output.join("\n").replace(/^\n+|\n+$/g, "") : text;
}

type ResolveMedia = (item: ConversationTimelineItemViewModel, block: ConversationTimelineArtifactReferenceContentBlock) => readonly ArtifactProjection[];

/** Presentation copies only. Native records, receipts and artifact identities stay intact. */
export function presentMediaTimeline(timeline: ConversationTimelineViewModel | null, resolve: ResolveMedia) {
  const requests: Record<string, string> = {};
  if (!timeline) return { timeline, requests };
  let previousMediaRequest = "", changed = false;
  const turns = timeline.turns.map(turn => {
    const media = turn.items.flatMap(item => item.contentBlocks.flatMap(block => block.type === "artifact_reference"
      ? resolve(item, block).filter(artifact => artifact.kind === "image" || artifact.kind === "video") : []));
    if (!media.length) return turn;
    const request = turn.items.filter(item => item.presentation === "user_message").flatMap(item => item.contentBlocks
      .flatMap(block => block.type === "text" ? [block.text] : [])).join("\n");
    if (mediaRequestTitle(request)) previousMediaRequest = request;
    requests[turn.turnId] = previousMediaRequest || request;
    const ids = [...new Set(media.map(artifact => artifact.artifactId))];
    let turnChanged = false;
    const items = turn.items.map(item => {
      if (item.kind !== "assistant_message") return item;
      let itemChanged = false;
      const contentBlocks = item.contentBlocks.map(block => {
        if (block.type !== "text" && block.type !== "code") return block;
        const text = hideMediaIdMetadata(block.text, ids);
        if (block.type === "code" && text.trim()) return block;
        if (text === block.text) return block;
        itemChanged = true;
        return Object.freeze({ ...block, text });
      });
      if (!itemChanged) return item;
      turnChanged = true;
      return Object.freeze({ ...item, contentBlocks: Object.freeze(contentBlocks) });
    });
    if (!turnChanged) return turn;
    changed = true;
    return Object.freeze({ ...turn, items: Object.freeze(items) });
  });
  return { timeline: changed ? Object.freeze({ ...timeline, turns: Object.freeze(turns) }) : timeline, requests };
}
