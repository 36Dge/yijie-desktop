import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMascotHoverTrigger } from "./home-mascot-hover";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const start = vi.fn();
  const gate = createMascotHoverTrigger({ start, now: () => Date.now() });
  gate.setEnabled(true);
  return { gate, start };
}

describe("mascot hover trigger", () => {
  it("ignores fly-bys and starts once after a full 180ms dwell", () => {
    const { gate, start } = setup();
    gate.setInside(true); vi.advanceTimersByTime(179); expect(start).not.toHaveBeenCalled();
    gate.setInside(false); vi.advanceTimersByTime(1000); expect(start).not.toHaveBeenCalled();
    gate.setInside(true); vi.advanceTimersByTime(180); expect(start).toHaveBeenCalledTimes(1);
    gate.setInside(true); vi.advanceTimersByTime(20000); expect(start).toHaveBeenCalledTimes(1);
    gate.dispose();
  });
  it("does not interrupt or queue an active performance when the pointer leaves and reenters", () => {
    const { gate, start } = setup();
    gate.setInside(true); vi.advanceTimersByTime(180);
    gate.setInside(false); gate.setInside(true); vi.advanceTimersByTime(10000);
    expect(start).toHaveBeenCalledTimes(1);
    gate.complete(); vi.advanceTimersByTime(20000);
    expect(start).toHaveBeenCalledTimes(1);
    gate.setInside(false); gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(2); gate.dispose();
  });
  it("starts cooldown at actual completion and requires a fresh entry after it expires", () => {
    const { gate, start } = setup();
    gate.setInside(true); vi.advanceTimersByTime(180);
    vi.advanceTimersByTime(30000); // A delayed clip is still playing, not on a wall-clock timeout.
    gate.complete(); gate.setInside(false);
    vi.advanceTimersByTime(4999); gate.setInside(true); vi.advanceTimersByTime(1000);
    expect(start).toHaveBeenCalledTimes(1); // Cooling-down entry cannot become a delayed replay.
    gate.setInside(false); gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(2); gate.dispose();
  });
  it("disabling for entry, reduced motion, hidden page or unavailable media cancels pending dwell", () => {
    const { gate, start } = setup();
    gate.setInside(true); vi.advanceTimersByTime(90); gate.setEnabled(false);
    vi.advanceTimersByTime(1000); expect(start).not.toHaveBeenCalled();
    gate.setEnabled(true); vi.advanceTimersByTime(1000); expect(start).not.toHaveBeenCalled();
    gate.setInside(false); gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(1); gate.dispose();
  });
  it("does not start merely because the entry animation finishes under the pointer", () => {
    const start = vi.fn(); const gate = createMascotHoverTrigger({ start });
    gate.setInside(true); gate.setEnabled(true); vi.advanceTimersByTime(1000);
    expect(start).not.toHaveBeenCalled();
    gate.setInside(false); gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(1); gate.dispose();
  });
  it("does not start another clip when a paused active performance becomes available again", () => {
    const { gate, start } = setup();
    gate.setInside(true); vi.advanceTimersByTime(180);
    gate.setEnabled(false); gate.setInside(false); vi.advanceTimersByTime(30000);
    gate.setEnabled(true); gate.setInside(true); vi.advanceTimersByTime(1000);
    expect(start).toHaveBeenCalledTimes(1);
    gate.complete(); gate.setInside(false); vi.advanceTimersByTime(5000);
    gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(2); gate.dispose();
  });
  it("ignores unrelated completion notifications and clears pending work on disposal", () => {
    const { gate, start } = setup();
    gate.complete(); gate.setInside(true); vi.advanceTimersByTime(180);
    expect(start).toHaveBeenCalledTimes(1);
    gate.complete(); gate.complete(); vi.advanceTimersByTime(5000);
    gate.setInside(false); gate.setInside(true); gate.dispose(); vi.advanceTimersByTime(1000);
    gate.setEnabled(true); gate.setInside(false); gate.setInside(true); gate.complete();
    vi.advanceTimersByTime(1000); expect(start).toHaveBeenCalledTimes(1);
  });
});
