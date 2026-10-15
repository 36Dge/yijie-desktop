/** Advance only after painting the next frame; elapsed wall time cannot skip a pose. */
export function createMascotPlayback(options: {
  frameCount: number;
  fps: number;
  paint: (frame: number) => boolean;
  complete: () => void;
}) {
  const interval = 1000 / options.fps;
  let frame = -1;
  let request: number | null = null;
  let previous: number | null = null;
  let elapsed = 0;
  let running = false;
  let finished = false;
  let disposed = false;

  function tick(now: number): void {
    request = null;
    if (!running || disposed) return;
    if (frame < 0) {
      if (options.paint(0)) frame = 0;
    } else {
      // A suspended WebView or a late decode must not fast-forward to the ending.
      elapsed += previous === null ? 0 : Math.max(0, Math.min(interval, now - previous));
      if (elapsed + 0.01 >= interval) {
        if (options.paint(frame + 1)) { frame += 1; elapsed = Math.max(0, elapsed - interval); }
        else elapsed = interval;
      }
    }
    previous = now;
    if (!running || disposed) return;
    if (frame === options.frameCount - 1) {
      running = false;
      finished = true;
      options.complete();
      return;
    }
    request = requestAnimationFrame(tick);
  }
  function play(): void {
    if (disposed || finished || running) return;
    running = true;
    previous = null;
    request = requestAnimationFrame(tick);
  }
  function pause(): void {
    running = false;
    previous = null;
    if (request !== null) cancelAnimationFrame(request);
    request = null;
  }
  function dispose(): void { pause(); disposed = true; }
  return { play, pause, dispose };
}
