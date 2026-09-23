/** One scope-bound, in-memory navigation handoff. Never an execution permit. */
export const SCHEDULE_DRAFT_GUIDE = "请帮我创建一个定时任务，每【时间间隔】在【时间/时区】执行【具体跨境电商任务】。";
let pending: { scope: string; revision: number; text: string } | null = null;
export function queueScheduleDraftIntent(scope: string, revision: number, text = SCHEDULE_DRAFT_GUIDE): void {
  pending = { scope, revision, text };
}
export function takeScheduleDraftIntent(scope: string, revision: number): string | null {
  const intent = pending; pending = null;
  return intent?.scope === scope && intent.revision === revision ? intent.text : null;
}
export function clearScheduleDraftIntent(): void { pending = null; }
