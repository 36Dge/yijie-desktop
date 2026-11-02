import { describe, expect, it } from "vitest";
import { createChatTextReveal, type TextRevealFrame } from "./chat-text-reveal";

function harness() {
  let time = 0; let id = 0;
  const callbacks = new Map<number, () => void>();
  const frames: TextRevealFrame[] = [];
  const reveal = createChatTextReveal({ request: cb => { callbacks.set(++id, cb); return id; }, cancel: id => { callbacks.delete(id); } }, () => time, frame => frames.push(frame));
  const at = (next: number) => { time = next; const work = [...callbacks.values()]; callbacks.clear(); work.forEach(cb => cb()); };
  const advance = (duration: number, step = 1000 / 60) => {
    const end = time + duration;
    while (time < end) at(Math.min(end, time + step));
  };
  return { reveal, frames, at, advance, callbacks, latest: () => frames[frames.length - 1] ?? { cursor: 0, ranges: [] } };
}
describe("paced message reveal", () => {
  it("spreads a burst into small reading steps and lets the last characters finish fading", () => {
    const h = harness(); const text = "连续显示新内容。".repeat(30);
    h.reveal.update(text, true);
    expect(h.latest().cursor).toBe(0);
    h.at(16); const first = h.latest().cursor;
    expect(first).toBeGreaterThan(0); expect(first).toBeLessThan(text.length);
    h.advance(1000); expect(h.latest().cursor).toBeGreaterThan(35);
    expect(h.latest().cursor).toBeLessThan(80);
    h.advance(10000); expect(h.latest().cursor).toBe(text.length);
    expect(Math.max(...h.frames.map((frame, i) => frame.cursor - (h.frames[i - 1]?.cursor ?? 0)))).toBeLessThanOrEqual(2);
    expect(h.latest().ranges).toEqual([]); expect(h.callbacks.size).toBe(0);
  });
  it("does not dump incoming chunks at a deadline during continuous arrivals", () => {
    const h = harness();
    for (let i = 1; i <= 20; i++) { h.reveal.update("字".repeat(i * 20), true); h.advance(100); }
    expect(h.latest().cursor).toBeGreaterThan(70);
    expect(h.latest().cursor).toBeLessThan(150);
    h.advance(10000); expect(h.latest().cursor).toBe(400);
  });
  it("keeps the same cadence and fade when execution completes, without replaying repeated snapshots", () => {
    const live = harness(); const done = harness();
    for (const h of [live, done]) { h.reveal.update("字".repeat(200), true); h.advance(500); }
    done.reveal.update("字".repeat(200), false); done.reveal.update("字".repeat(200), false);
    for (const h of [live, done]) h.advance(128);
    expect(done.latest()).toEqual(live.latest());
    expect(done.latest().cursor).toBeLessThan(80);
    done.advance(7000); expect(done.latest().cursor).toBe(200);
    done.reveal.update("字".repeat(200), false); expect(done.callbacks.size).toBe(0);
  });
  it("maintains the same reading speed on 30, 60 and 120 Hz displays", () => {
    const cursors = [30, 60, 120].map(hz => {
      const h = harness(); h.reveal.update("字".repeat(80), true); h.advance(1000, 1000 / hz); return h.latest().cursor;
    });
    expect(Math.max(...cursors) - Math.min(...cursors)).toBeLessThanOrEqual(1);
    expect(cursors.every(cursor => cursor >= 39 && cursor <= 42)).toBe(true);
  });
  it("does not award another immediate character for every tiny incoming packet", () => {
    const h = harness();
    for (let i = 1; i <= 120; i++) { h.reveal.update("字".repeat(i), true); h.advance(1000 / 120); }
    expect(h.latest().cursor).toBeGreaterThanOrEqual(39);
    expect(h.latest().cursor).toBeLessThanOrEqual(43);
    h.advance(4000); expect(h.latest().cursor).toBe(120);
  });
  it("does not turn a late frame or idle transport gap into a large text jump", () => {
    const h = harness(); h.reveal.update("字".repeat(300), true); h.advance(100);
    const cursor = h.latest().cursor; h.at(5000);
    expect(h.latest().cursor - cursor).toBeLessThanOrEqual(4);
    h.reveal.finish(); h.at(10000); h.reveal.update("字".repeat(350), true); h.advance(16);
    expect(h.latest().cursor - 300).toBeLessThanOrEqual(2);
  });
  it("retains fresh text until its fade ends, including after successful completion", () => {
    const h = harness(); h.reveal.update("字", true); h.at(16); h.reveal.update("字", false);
    h.advance(300); expect(h.latest().ranges).toHaveLength(1);
    h.advance(300); expect(h.latest().ranges).toEqual([]); expect(h.callbacks.size).toBe(0);
  });
  it("keeps pacing when Markdown revises only the unseen tail, including its terminal parse", () => {
    const h = harness(); h.reveal.update("稳定前文".repeat(30) + "| 未完成表格", true); h.advance(200);
    const before = h.latest();
    const next = "稳定前文".repeat(30) + "表头完整单元格";
    h.reveal.update(next, false);
    expect(h.latest()).toEqual(before);
    h.advance(32); expect(h.latest().cursor - before.cursor).toBeLessThanOrEqual(3);
    h.advance(5000); expect(h.latest().cursor).toBe(next.length);
  });
  it("never splits emoji, ZWJ or combining character sequences, including split arrivals", () => {
    const h = harness(); const text = "中文👨‍👩‍👧‍👦e\u0301🇨🇳结束";
    h.reveal.update(text, true);
    const boundaries = new Set([...new Intl.Segmenter(undefined, {granularity: "grapheme"}).segment(text)].map(s => s.index + s.segment.length));
    for (let t = 16; t <= 176; t += 16) { h.at(t); expect(boundaries.has(h.latest().cursor)).toBe(true); }
    h.reveal.update(text + "👩", true); h.reveal.update(text + "👩‍💻", true);
    h.advance(1000); expect(h.latest().cursor).toBe((text + "👩‍💻").length);
  });
  it("keeps a completed split emoji in one fresh span even when its first part was already visible", () => {
    const h = harness(); h.reveal.update("你好👩", true); h.advance(1000);
    h.reveal.update("你好👩‍💻", true); h.advance(32);
    expect(h.latest().cursor).toBe("你好👩‍💻".length);
    expect(h.latest().ranges).toEqual([{start: 2, end: 7, at: expect.any(Number)}]);
  });
  it("shows history, replacements and reduced-motion content directly without replay", () => {
    const h = harness(); h.reveal.update("历史", false); expect(h.latest().cursor).toBe(2);
    h.reveal.update("历史与新增", true, false); expect(h.latest().cursor).toBe(5);
    h.reveal.update("历史与新增", true, true); expect(h.callbacks.size).toBe(0);
    h.reveal.update("修订", true); expect(h.latest().cursor).toBe(2);
    h.reveal.update("", false); expect(h.latest().cursor).toBe(0);
  });
  it("pauses DOM publication during selection and disposes pending animation", () => {
    const h = harness(); h.reveal.update("字".repeat(100), true); h.at(16);
    const count = h.frames.length; h.reveal.pause(true); h.at(300); expect(h.frames.length).toBe(count);
    const before = h.latest().cursor;
    h.reveal.pause(false); h.at(316); expect(h.latest().cursor - before).toBeLessThanOrEqual(2);
    h.advance(4000); expect(h.latest().cursor).toBe(100);
    h.reveal.dispose(); expect(h.callbacks.size).toBe(0);
  });
});
