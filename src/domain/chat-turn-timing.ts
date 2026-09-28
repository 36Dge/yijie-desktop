import type { NativeTurnTiming } from "../api/generated/chat-turn-timing.gen";

function elapsedLabel(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return `${hours > 0 ? `${hours}小时` : ""}${minutes > 0 ? `${minutes}分` : ""}${remainder}秒`;
}

/** Presentation only: final elapsed time always comes from Codex's monotonic durationMs. */
export function turnTimingLabel(timing: NativeTurnTiming | null | undefined, live: boolean, now: number): string | null {
  if (!timing) return null;
  if (timing.duration_ms.state === "known" && timing.duration_ms.value !== undefined) {
    return `用时 ${elapsedLabel(Math.floor(timing.duration_ms.value / 1000))}`;
  }
  if (!live || timing.completed_at.state !== "unknown" || timing.started_at.state !== "known" ||
      timing.started_at.value === undefined) return null;
  // A future source time (clock skew) is unknown, not a fabricated zero duration.
  const elapsed = Math.floor(now / 1000) - timing.started_at.value;
  return elapsed >= 0 ? `已处理 ${elapsedLabel(elapsed)}` : null;
}
