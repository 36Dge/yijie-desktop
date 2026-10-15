/** Gates a decorative performance; leaving the target never cancels an active clip. */
export function createMascotHoverTrigger(options: {
  start: () => void;
  now?: () => number;
  dwellMs?: number;
  cooldownMs?: number;
}) {
  const now = options.now ?? (() => performance.now());
  const dwellMs = options.dwellMs ?? 180;
  const cooldownMs = options.cooldownMs ?? 5000;
  let enabled = false;
  let inside = false;
  let consumedEntry = false;
  let active = false;
  let disposed = false;
  let cooldownUntil = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancelDwell(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function setEnabled(value: boolean): void {
    if (disposed || enabled === value) return;
    enabled = value;
    cancelDwell();
    // Becoming ready/unhidden under a stationary pointer is not a new entry.
    if (inside) consumedEntry = true;
  }
  function setInside(value: boolean): void {
    if (disposed || inside === value) return;
    inside = value;
    cancelDwell();
    if (!inside) { consumedEntry = false; return; }
    if (!enabled || active || now() < cooldownUntil) { consumedEntry = true; return; }
    consumedEntry = false;
    timer = setTimeout(() => {
      timer = null;
      if (disposed || !enabled || !inside || active || consumedEntry) return;
      consumedEntry = true;
      active = true;
      options.start();
    }, dwellMs);
  }
  /** Call only after the actual last frame was painted, or the attempt failed. */
  function complete(): void {
    if (disposed || !active) return;
    active = false;
    cooldownUntil = now() + cooldownMs;
    // Pointer entries during playback cannot queue another performance.
    if (inside) consumedEntry = true;
    cancelDwell();
  }
  function dispose(): void { disposed = true; cancelDwell(); }
  return { setEnabled, setInside, complete, dispose };
}
