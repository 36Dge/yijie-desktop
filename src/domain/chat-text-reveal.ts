import type { FrameProjectionScheduler } from "./frame-batched-projection";

export const CHAT_REVEAL_RATE = 40;
export const CHAT_REVEAL_CATCHUP_RATE = 72;
export const CHAT_REVEAL_FADE_MS = 600;
const MAX_FRAME_MS = 50;
const RATE_EASE_MS = 240;
export interface RevealRange { readonly start: number; readonly end: number; readonly at: number }
export interface TextRevealFrame { readonly cursor: number; readonly ranges: readonly RevealRange[] }

/** Ephemeral presentation offsets only. Never owns execution status or saved text. */
export function createChatTextReveal(
  scheduler: FrameProjectionScheduler,
  now: () => number,
  publish: (frame: TextRevealFrame) => void,
) {
  let text = "";
  let cursor = 0;
  let ends: number[] = [];
  let ranges: RevealRange[] = [];
  let lastFrame = 0;
  let lastReveal = -Infinity;
  let credit = 0;
  let rate = CHAT_REVEAL_RATE;
  let frame: number | null = null;
  let live = false;
  let enabled = true;
  let paused = false;
  let pendingSettle = false;
  let disposed = false;
  // Segment only on incoming data, never on presentation frames. Re-segment the
  // last grapheme on append so split combining marks / ZWJ sequences stay whole.
  const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  function segment(next: string, append: boolean) {
    const start = append && ends.length > 1 ? ends[ends.length - 2]! : 0;
    if (append) ends.pop(); else ends = [];
    for (const part of segmenter?.segment(next.slice(start)) ?? []) ends.push(start + part.index + part.segment.length);
  }
  function cancel() {
    if (frame !== null) scheduler.cancel(frame);
    frame = null;
  }
  function emit() { publish({ cursor, ranges: [...ranges] }); }
  function settle() {
    cancel();
    if (paused) { pendingSettle = true; return; }
    pendingSettle = false;
    cursor = text.length;
    credit = 0;
    rate = CHAT_REVEAL_RATE;
    ranges = [];
    emit();
  }
  function schedule() {
    if (disposed || paused || frame !== null) return;
    frame = scheduler.request(tick);
  }
  function tick() {
    frame = null;
    if (disposed || paused) return;
    const time = now();
    const before = cursor;
    ranges = ranges.filter(range => time - range.at < CHAT_REVEAL_FADE_MS);
    if (cursor < text.length) {
      // Count graphemes, not UTF-16 units or frames. Fractional credit keeps the
      // same cadence on 60/120 Hz screens, without forcing a character per frame.
      let lo = 0; let hi = ends.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (ends[mid]! <= cursor) lo = mid + 1; else hi = mid; }
      const remaining = ends.length - lo;
      const elapsed = Math.min(MAX_FRAME_MS, Math.max(0, time - lastFrame));
      const targetRate = Math.min(CHAT_REVEAL_CATCHUP_RATE, Math.max(CHAT_REVEAL_RATE, remaining / 2));
      rate += (targetRate - rate) * (1 - Math.exp(-elapsed / RATE_EASE_MS));
      credit += rate * elapsed / 1000;
      const count = Math.min(remaining, Math.floor(credit));
      if (count > 0) {
        cursor = ends[lo + count - 1]!;
        credit -= count;
        lastReveal = time;
        // An append can complete an already visible emoji/combining sequence.
        // Keep that entire grapheme in one span instead of splitting its glyph.
        const start = lo > 0 ? ends[lo - 1]! : 0;
        if (start < before) ranges = ranges.flatMap(range => range.start >= start ? [] : [{ ...range, end: Math.min(range.end, start) }]);
        ranges.push({ start, end: cursor, at: time });
      }
      if (cursor === text.length) credit = Math.min(credit, 1);
    }
    lastFrame = time;
    emit();
    if (cursor < text.length || ranges.length > 0) schedule();
  }
  return {
    update(next: string, nextLive: boolean, nextEnabled = true) {
      if (disposed || (next === text && nextLive === live && nextEnabled === enabled)) return;
      const append = next.startsWith(text);
      const changed = next !== text;
      const wasCaughtUp = cursor === text.length;
      // Markdown can revise its still-hidden tail (e.g. a table delimiter or
      // closing fence). Only a correction to text already on screen needs an
      // immediate replacement; reparsing unseen content must not flush a burst.
      const preservesVisible = append || next.startsWith(text.slice(0, cursor));
      const canAnimate = segmenter !== null && nextEnabled && enabled && (live || nextLive) && preservesVisible;
      if (changed) segment(next, append);
      text = next;
      const time = now();
      // The first glyph after a real idle gap can appear immediately. Tiny
      // packets on every frame must still share the same fractional budget.
      if (changed && canAnimate && wasCaughtUp && time - lastReveal > 100) {
        lastFrame = time;
        credit = 1;
        rate = CHAT_REVEAL_RATE;
      }
      // A successful terminal event does not accelerate the reading cursor or
      // strip the fade. Execution state is already delivered by the caller.
      live = nextLive; enabled = nextEnabled;
      if (!canAnimate) settle();
      else if (changed || cursor < text.length || ranges.length) schedule();
    },
    pause(value: boolean) {
      paused = value;
      if (paused) cancel();
      else if (pendingSettle || !enabled) settle();
      else if (cursor < text.length || ranges.length) { lastFrame = now(); schedule(); }
    },
    finish: settle,
    dispose() { disposed = true; cancel(); ranges = []; ends = []; text = ""; },
  };
}
