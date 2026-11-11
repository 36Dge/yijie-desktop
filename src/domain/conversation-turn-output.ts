import type { ConversationReadingNode } from "./conversation-activity-presentation";
import { hasUnclassifiedToolContinuation } from "./conversation-process";
import type { ConversationTimelineTurnViewModel } from "./conversation-timeline";

type MessageNode = Exclude<ConversationReadingNode, { kind: "activity" }>;
export type ConversationTurnOutput = Readonly<{
  kind: "output";
  identity: string;
  answer: MessageNode | null;
  artifacts: readonly MessageNode[];
}>;
export type ConversationTurnReadingNode = ConversationReadingNode | ConversationTurnOutput;

/** Group product output for reading, without changing any native Item or reference.
 * Turn-bound artifacts have their own ordinal range, not an assistant Item ID.
 * Keep that authority and order; use the last readable answer as their container.
 * The output key also exists before text arrives so live cards remain mounted.
 */
export function groupConversationTurnOutput(
  turn: ConversationTimelineTurnViewModel,
  nodes: readonly ConversationReadingNode[],
): readonly ConversationTurnReadingNode[] {
  const belongsToTurn = (node: MessageNode) => node.item.threadId === turn.threadId && node.item.turnId === turn.turnId;
  const artifacts = nodes.filter((node): node is MessageNode => node.kind !== "activity" &&
    node.item.presentation === "artifact" && belongsToTurn(node));
  if (!artifacts.length) return nodes;

  const answer = [...nodes].reverse().find((node): node is MessageNode => node.kind !== "activity" &&
    belongsToTurn(node) && node.item.kind === "assistant_message" && !node.process &&
    (node.answerCandidate || ["final_answer", "assistant_unclassified"].includes(node.item.presentation)) &&
    !hasUnclassifiedToolContinuation(node.item, turn.items) &&
    node.item.contentBlocks.some(block => (block.type === "text" || block.type === "code") && block.text.trim())) ?? null;
  const anchor = answer ?? artifacts[0]!;
  const grouped = new Set<ConversationReadingNode>(artifacts);
  if (answer) grouped.add(answer);
  const output: ConversationTurnOutput = {kind: "output", identity: `${turn.identity}:output`, answer, artifacts};
  return nodes.flatMap<ConversationTurnReadingNode>(node => node === anchor ? [output] : grouped.has(node) ? [] : [node]);
}
