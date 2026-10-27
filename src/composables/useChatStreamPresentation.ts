/// <reference lib="es2022.intl" />
import { onBeforeUnmount, shallowRef, watch } from "vue";
import type { ConversationTimelineContentBlock as Block } from "../domain/conversation-timeline";

// Presentation only: authoritative snapshots, status and copy actions stay synchronous.
// Catch up within a short window, instead of accumulating a fixed-speed typing queue.
const CATCH_UP_MS = 180;
const MIN_UNITS_PER_MS = 0.06;
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
const hasText = (block: Block) => block.type === "text" || block.type === "code";
const textLength = (blocks: readonly Block[]) => blocks.reduce((sum, block) => sum + (hasText(block) ? block.text.length : 0), 0);

function appendsTo(before: readonly Block[], after: readonly Block[]): boolean {
  return after.length >= before.length && before.every((block, index) => {
    const next = after[index]!;
    if (block.identity !== next.identity || block.type !== next.type) return false;
    if (!hasText(block) || !hasText(next)) return block === next;
    return index === before.length - 1 ? next.text.startsWith(block.text) : next.text === block.text;
  });
}

/** A single cursor across the message preserves paragraph/list/code arrival order. */
export function useChatStreamPresentation(
  source: () => readonly Block[],
  streaming: () => boolean,
  enabled: () => boolean,
) {
  const displayed = shallowRef(source());
  let target = source();
  let cursor = textLength(target);
  let frame: number | null = null;
  let lastFrame = 0;
  let deadline = 0;
  let rate = MIN_UNITS_PER_MS;
  let motion: MediaQueryList | null = null;
  let listening = false;

  function cancel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function showAll() {
    cancel();
    cursor = textLength(target);
    displayed.value = target;
  }

  function selectionActive() {
    return document.getSelection()?.isCollapsed === false;
  }

  function bypass() {
    return !segmenter || document.hidden || motion?.matches || typeof requestAnimationFrame !== "function";
  }

  function publishPrefix() {
    let remaining = Math.floor(cursor);
    const blocks: Block[] = [];
    for (const block of target) {
      if (!hasText(block)) {
        blocks.push(block);
      } else if (remaining >= block.text.length) {
        blocks.push(block);
        remaining -= block.text.length;
      } else {
        // Never reveal half an emoji, surrogate pair or combining sequence.
        const segment = segmenter?.segment(block.text).containing(remaining);
        const end = segment && segment.index < remaining ? segment.index + segment.segment.length : remaining;
        if (end > 0) blocks.push({ ...block, text: block.text.slice(0, end) });
        break;
      }
    }
    displayed.value = blocks;
  }

  function tick(now: number) {
    frame = null;
    if (selectionActive()) return;
    if (bypass() || now >= deadline) return showAll();
    cursor = Math.min(textLength(target), cursor + Math.max(0, now - lastFrame) * rate);
    lastFrame = now;
    if (cursor >= textLength(target)) return showAll();
    publishPrefix();
    frame = requestAnimationFrame(tick);
  }

  function schedule() {
    if (selectionActive()) return;
    if (bypass()) return showAll();
    const now = performance.now();
    rate = Math.max(MIN_UNITS_PER_MS, (textLength(target) - cursor) / CATCH_UP_MS);
    deadline = now + CATCH_UP_MS;
    if (frame === null) {
      lastFrame = now;
      frame = requestAnimationFrame(tick);
    }
  }

  function resume() {
    if (cursor >= textLength(target)) return;
    if (selectionActive()) cancel();
    else schedule();
  }

  function removeListeners() {
    if (!listening) return;
    document.removeEventListener("selectionchange", resume);
    document.removeEventListener("visibilitychange", resume);
    motion?.removeEventListener("change", resume);
    motion = null;
    listening = false;
  }

  watch(() => streaming() && enabled(), active => {
    if (!active) return removeListeners();
    motion = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
    document.addEventListener("selectionchange", resume);
    document.addEventListener("visibilitychange", resume);
    motion.addEventListener("change", resume);
    listening = true;
  }, { immediate: true });

  watch(() => [source(), streaming(), enabled()] as const, ([blocks, live, animate], previous) => {
    const before = target;
    target = blocks;
    if (!animate || !live || !previous?.[1] || !appendsTo(before, blocks)) return showAll();
    if (textLength(target) <= cursor) return showAll();
    schedule();
  });

  onBeforeUnmount(() => {
    cancel();
    removeListeners();
  });
  return displayed;
}
