import type { NativeTurnTiming } from "../api/generated/chat-turn-timing.gen";
import type { ConversationTimelineTurnViewModel } from "./conversation-timeline";

function elapsedLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return `${hours > 0 ? `${hours}小时` : ""}${minutes > 0 ? `${minutes}分` : ""}${remainder}秒`;
}

function compactDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return milliseconds <= 60_000 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

/** Presentation only: final elapsed time always comes from Codex's monotonic durationMs. */
export function turnTimingLabel(timing: NativeTurnTiming | null | undefined, live: boolean, now: number, status: ConversationTimelineTurnViewModel["domainStatus"] = "unknown"): string | null {
  if (!timing) return null;
  if (timing.duration_ms.state === "known" && timing.duration_ms.value !== undefined) {
    const duration = timing.duration_ms.value;
    if (status === "completed") return `已完成 ${compactDuration(duration)}`;
    return `用时 ${elapsedLabel(Math.floor(duration / 1000))}`;
  }
  if (!live || timing.completed_at.state !== "unknown" || timing.started_at.state !== "known" ||
      timing.started_at.value === undefined) return null;
  // A future source time (clock skew) is unknown, not a fabricated zero duration.
  const elapsed = now - timing.started_at.value * 1000;
  return elapsed >= 0 ? `执行 ${compactDuration(elapsed)}` : null;
}
