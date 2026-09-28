import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import type { NativeTurnTiming } from "../api/generated/chat-turn-timing.gen";
import type { ConversationTimelineTurnViewModel } from "../domain/conversation-timeline";
import { turnTimingLabel } from "../domain/chat-turn-timing";

function terminal(turn: ConversationTimelineTurnViewModel): boolean {
  return turn.domainStatus === "completed" || turn.domainStatus === "failed" || turn.domainStatus === "interrupted";
}
function live(turn: ConversationTimelineTurnViewModel): boolean {
  return turn.liveObserved === true && turn.source === "native_observed" &&
    (turn.domainStatus === "in_progress" || turn.domainStatus === "waiting_approval") &&
    turn.availability !== "unavailable" && turn.phase !== "recovery_required";
}

type TimingRequest = { key: string; controller: AbortController; attempts: number; pending: boolean };

export function useChatTurnTiming(options: {
  scope: () => string | null;
  turns: () => readonly ConversationTimelineTurnViewModel[];
  read: (turnId: string, signal: AbortSignal) => Promise<NativeTurnTiming | null>;
}) {
  const facts = shallowRef<Readonly<Record<string, NativeTurnTiming | null>>>({});
  const now = ref(Date.now());
  const requests = new Map<string, TimingRequest>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let currentScope: string | null = null;
  let active = 0;
  let stopped = false;

  function reset() {
    for (const request of requests.values()) request.controller.abort();
    requests.clear();
    for (const timeout of retries) clearTimeout(timeout);
    retries.clear();
    facts.value = {};
  }

  async function load(id: string, request: TimingRequest) {
    active++;
    request.pending = true;
    request.attempts++;
    let needsRetry = false;
    try {
      const timing = await options.read(id, request.controller.signal);
      if (request.controller.signal.aborted || requests.get(id) !== request) return;
      facts.value = { ...facts.value, [id]: timing };
      needsRetry = request.key === "ended"
        ? timing?.duration_ms.state !== "known"
        : timing?.started_at.state !== "known";
    } catch {
      // Timing is optional metadata; a read failure must not affect conversation authority.
      needsRetry = true;
    } finally {
      active--;
      if (!request.controller.signal.aborted && requests.get(id) === request && needsRetry && request.attempts < 3) {
        const timeout = setTimeout(() => {
          retries.delete(timeout);
          request.pending = false;
          pump();
        }, request.attempts * 1000);
        retries.add(timeout);
      }
      pump();
    }
  }

  function pump() {
    if (stopped) return;
    for (const [id, request] of requests) {
      if (active >= 2) break;
      if (!request.pending) void load(id, request);
    }
  }

  // Watch lifecycle keys, never streamed text. No per-second IPC polling.
  watch(() => ({ scope: options.scope(), turns: options.turns().map(turn => ({
    id: turn.turnId,
    key: terminal(turn) ? "ended" : live(turn) ? "live" : "history",
    native: turn.source === "native_observed" || turn.source === "native_rebuilt",
  })) }), ({ scope, turns }) => {
    if (scope !== currentScope) { reset(); currentScope = scope; }
    if (!scope) return;
    const ids = new Set(turns.map(turn => turn.id));
    for (const [id, request] of requests) {
      if (!ids.has(id)) { request.controller.abort(); requests.delete(id); }
    }
    // Current/live turns first, then recent history. At most two Host reads concurrently.
    for (const turn of [...turns].reverse().sort((a, b) => Number(b.key === "live") - Number(a.key === "live"))) {
      if (!turn.native || requests.get(turn.id)?.key === turn.key) continue;
      requests.get(turn.id)?.controller.abort();
      requests.set(turn.id, { key: turn.key, controller: new AbortController(), attempts: 0, pending: false });
    }
    pump();
  }, { immediate: true });

  const ticking = computed(() => options.scope() !== null && options.turns().some(turn =>
    live(turn) && facts.value[turn.turnId]?.started_at.state === "known" &&
    facts.value[turn.turnId]?.completed_at.state === "unknown" && facts.value[turn.turnId]?.duration_ms.state !== "known"));
  let interval: ReturnType<typeof setInterval> | undefined;
  watch(ticking, enabled => {
    clearInterval(interval);
    now.value = Date.now();
    if (enabled) interval = setInterval(() => { now.value = Date.now(); }, 1000);
  }, { immediate: true });
  onScopeDispose(() => { stopped = true; reset(); clearInterval(interval); });

  return computed(() => Object.fromEntries(options.turns().map(turn => [
    turn.turnId, turnTimingLabel(facts.value[turn.turnId], live(turn), now.value),
  ])));
}
