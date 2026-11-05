import { createChatMarkdownParser } from "./chat-markdown";
import type { ConversationTimelineItemViewModel as Item, ConversationTimelineTurnViewModel as Turn } from "./conversation-timeline";

/** A reading view of already allowed native summary blocks, never raw content.
 * Keep original Item/block identities; this is not a synthetic Runtime Item. */
export function reasoningSummaryItems(turn: Turn): readonly Item[] {
  return turn.items.flatMap(item => {
    if (item.presentation !== "reasoning" || item.availability === "unavailable" || item.reasoning?.reasonCode) return [];
    const contentBlocks = item.contentBlocks.filter(block => block.type === "text" && block.reasoningSource === "summary" && block.text.trim());
    return contentBlocks.length ? [{...item, contentBlocks}] : [];
  });
}

export function reasoningSummaryHeading(item: Item): string {
  const document = createChatMarkdownParser()(item.contentBlocks, "rich", true);
  const heading = [...document.nodes].reverse().find(node => node.kind === "heading" ||
    node.kind === "paragraph" && node.inlines.length === 1 && node.inlines[0]?.kind === "strong");
  const blocks = item.contentBlocks.filter(block => block.type === "text");
  const source = blocks[blocks.length - 1];
  const line = source?.text.trimEnd().split(/\r?\n/).reverse().find(value => value.trim()) ?? "";
  const text = heading && "inlines" in heading
    ? heading.inlines.map(inline => inline.text).join("")
    : source ? createChatMarkdownParser()([{...source, text: line}], "rich", true).text : "";
  const characters = Array.from(text.replace(/\s+/gu, " ").trim());
  return characters.length > 80 ? `${characters.slice(0, 80).join("")}…` : characters.join("");
}

/** A readable current summary owns one status location. Concurrent tools and
 * native retry notices keep their existing status precedence. */
export function reasoningSummaryIsCurrent(turn: Turn): boolean {
  const latest = turn.items[turn.items.length - 1];
  if (!latest || latest.presentation !== "reasoning" || latest.reasoning?.reasonCode || latest.availability === "unavailable" ||
    !latest.contentBlocks.some(block => block.type === "text" && block.reasoningSource === "summary" && block.text.trim())) return false;
  const notice = turn.traceNotices?.[turn.traceNotices.length - 1];
  if (notice?.scope === "turn" && notice.method === "error" && notice.willRetry === true && notice.sequence === turn.traceSequence) return false;
  for (const item of [...turn.items].reverse()) {
    if (["user_message", "commentary", "assistant_unclassified", "final_answer"].includes(item.presentation)) break;
    if (item.busy && ["command", "tool", "web_search"].includes(item.presentation)) return false;
  }
  return true;
}

export function conversationReasoningSummary(turn: Turn, live: boolean) {
  const items = reasoningSummaryItems(turn);
  const latest = items[items.length - 1];
  if (!latest) return null;
  const active = live && reasoningSummaryIsCurrent(turn);
  const heading = reasoningSummaryHeading(latest);
  return {
    identity: `${turn.identity}:reasoning-summary`,
    items,
    title: `${active ? "正在思考" : "思考摘要"}${heading ? ` · ${heading}` : ""}`,
    key: latest.identity,
    state: active ? "thinking" as const : "summary" as const,
    stateMessage: items.some(item => item.availability === "partial") ? "部分思考摘要信息不完整，已保留可读内容。" : null,
  };
}
