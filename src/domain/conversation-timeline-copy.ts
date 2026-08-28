import type { ConversationTimelineItemViewModel } from "./conversation-timeline";

export function copyableTimelineItemText(
  item: ConversationTimelineItemViewModel,
): string | null {
  const segments = item.contentBlocks.flatMap((block) => {
    if ((block.type === "text" || block.type === "code") && block.text.length > 0) {
      return [block.text];
    }
    return [];
  });
  return segments.length > 0 ? segments.join("\n\n") : null;
}
