import type { ContextWindowSnapshot } from "../api/context-window-client";
import type { ConversationTimelineViewModel } from "./conversation-timeline";

/** Enrich only exact native identities; never synthesize an assistant Item or phase. */
export function withContextWindowTimeline(timeline: ConversationTimelineViewModel | null, snapshot: ContextWindowSnapshot | null): ConversationTimelineViewModel | null {
  if (!timeline || !snapshot?.thread_id || !snapshot.compactions.length) return timeline;
  return {
    ...timeline,
    turns: timeline.turns.map(turn => {
      if (turn.nativeThreadId !== snapshot.thread_id) return turn;
      const updates = new Map(snapshot.compactions.filter(item => item.turn_id === turn.nativeTurnId).map(item => [item.item_id, item]));
      return { ...turn, items: turn.items.map(item => {
        const update = updates.get(item.itemId);
        if (!update || item.kind !== "unknown") return item;
        return { ...item, presentation: "context_update" as const, role: "assistant" as const,
          contextUpdateState: update.state, availability: "available" as const,
          activityLabel: undefined, busy: update.state === "in_progress",
          collapsible: false, defaultExpanded: true, copyPolicy: "none" as const,
        };
      }) };
    }),
  };
}
