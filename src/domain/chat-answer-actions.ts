import { modelDefinitions as legacyModels } from "./chat-models.generated";
import { modelDefinitions as currentModels } from "./chat-models-v2.generated";
import type { NativeTurnTiming } from "../api/generated/chat-turn-timing.gen";
import type { ConversationTimelineItemViewModel, ConversationTimelineTurnViewModel } from "./conversation-timeline";
import { observedProgressMessages } from "./conversation-process";

export const answerFeedbackReasons = Object.freeze([
  "误解了我的问题", "上下文理解错误", "回答模糊/不具体", "代码有错误", "回答不专业", "代码格式问题",
] as const);
export type AnswerFeedbackReason = (typeof answerFeedbackReasons)[number];
export type AnswerVote = "like" | "dislike" | null;

export function isCompletedAnswer(item: ConversationTimelineItemViewModel, turn: ConversationTimelineTurnViewModel): boolean {
  return turn.domainStatus === "completed" && item.domainStatus === "completed" && item.kind === "assistant_message" &&
    ["final_answer", "assistant_unclassified"].includes(item.presentation) && !observedProgressMessages(turn.items).has(item.identity);
}
export function answerModelBadge(profileId: string | null | undefined): {label: string; icon: "modelKimi" | "modelMiniMax" | "assistant"} {
  const definition = [...currentModels, ...legacyModels].find(model => model.profile_id === profileId);
  if (!definition) return {label: profileId === undefined ? "模型信息…" : "模型未知", icon: "assistant"};
  return {label: definition.label, icon: definition.provider === "kimi" ? "modelKimi" : "modelMiniMax"};
}
export function nativeCompletedAt(timing: NativeTurnTiming | null | undefined): number | null {
  return timing?.completed_at.state === "known" && timing.completed_at.value !== undefined ? timing.completed_at.value : null;
}
export function answerCompletionTime(seconds: number | null | undefined, now = Date.now()) {
  if (seconds === null || seconds === undefined || !Number.isSafeInteger(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  const current = new Date(now), yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const clock = date.toLocaleTimeString("zh-CN", {hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
  const prefix = date.toDateString() === current.toDateString() ? "" : date.toDateString() === yesterday.toDateString() ? "昨天 "
    : `${date.getFullYear() === current.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth()+1}月${date.getDate()}日 `;
  return {label: prefix + clock, datetime: date.toISOString(), title: `完成于 ${date.toLocaleString("zh-CN", {year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"})}`};
}
