import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMascotPlayback } from "./home-mascot-playback";

let now = 0, id = 0;
const requests = new Map<number, FrameRequestCallback>();
beforeEach(() => {
  now = 0; id = 0; requests.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { requests.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (request: number) => { requests.delete(request); });
});
afterEach(() => vi.unstubAllGlobals());
function advance(ms = 1000 / 24): void {
  now += ms;
  const callbacks = [...requests.values()]; requests.clear();
  callbacks.forEach(callback => callback(now));
}
describe("mascot presentation clock", () => {
  it("paints all 84 poses in order, completes only after the last paint, and never replays", () => {
    const frames: number[] = [];
    const complete = vi.fn();
    const player = createMascotPlayback({ frameCount: 84, fps: 24, paint: frame => { frames.push(frame); return true; }, complete });
    player.play();
    for (let i = 0; i < 83; i++) advance();
    expect(frames).toEqual(Array.from({ length: 83 }, (_, i) => i));
    expect(complete).not.toHaveBeenCalled();
    advance();
    expect(frames[frames.length - 1]).toBe(83);
    expect(complete).toHaveBeenCalledOnce();
    expect(requests.size).toBe(0);
    player.play(); advance(10000);
    expect(frames).toHaveLength(84);
  });
  it("does not jump to a final pose when 3.5 seconds elapse without a paint", () => {
    const frames: number[] = [];
    const complete = vi.fn();
    const player = createMascotPlayback({ frameCount: 84, fps: 24, paint: frame => { frames.push(frame); return true; }, complete });
    player.play(); advance(); advance(3500);
    expect(frames).toEqual([0, 1]);
    expect(complete).not.toHaveBeenCalled();
  });
  it("waits at the current pose for a sheet to decode instead of skipping its frames", () => {
    let available = false;
    const frames: number[] = [];
    const player = createMascotPlayback({ frameCount: 84, fps: 24, paint: frame => {
      if (frame >= 6 && !available) return false;
      frames.push(frame); return true;
    }, complete: vi.fn() });
    player.play();
    for (let i = 0; i < 20; i++) advance();
    expect(frames).toEqual([0, 1, 2, 3, 4, 5]);
    available = true; advance();
    expect(frames[frames.length - 1]).toBe(6);
  });
  it("pauses without changing pose and resumes without counting time in the background", () => {
    const frames: number[] = [];
    const player = createMascotPlayback({ frameCount: 84, fps: 24, paint: frame => { frames.push(frame); return true; }, complete: vi.fn() });
    player.play(); advance(); advance();
    player.pause(); advance(30000);
    expect(frames).toEqual([0, 1]); expect(requests.size).toBe(0);
    player.play(); advance();
    expect(frames).toEqual([0, 1]);
    advance(); expect(frames).toEqual([0, 1, 2]);
    player.dispose(); advance(30000);
    expect(requests.size).toBe(0); expect(frames).toEqual([0, 1, 2]);
  });
});
