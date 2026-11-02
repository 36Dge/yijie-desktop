// Bounded, content-free, in-memory development measurements. No text, URLs,
// conversation identifiers, persistent logs or external telemetry.
export type ChatRenderStage = "markdown" | "conversation" | "timeline";
const samples = new Map<ChatRenderStage, number[]>();
let enabled = import.meta.env.DEV;
export function setChatRenderMeasurementEnabled(value: boolean) { enabled = value; samples.clear(); }
export function measureChatRender<T>(stage: ChatRenderStage, action: () => T): T {
  if (!enabled) return action();
  const start = performance.now();
  try { return action(); }
  finally {
    const values = samples.get(stage) ?? [];
    values.push(performance.now() - start);
    if (values.length > 256) values.shift();
    samples.set(stage, values);
  }
}
export function chatRenderMeasurements() {
  return Object.fromEntries([...samples].map(([stage, values]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return [stage, { samples: values.length, p50Ms: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
      p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0, maxMs: sorted[sorted.length - 1] ?? 0 }];
  }));
}
