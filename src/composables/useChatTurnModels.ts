import { computed, onScopeDispose, shallowRef, watch } from "vue";
import { readTurnModel } from "../api/chat-turn-model-client";

type Scope = {contextId: string; sessionId: string};
type Request = {controller: AbortController; pending: boolean; done: boolean; attempts: number};
/** Immutable per-turn reads; never observes or changes the composer's model. */
export function useChatTurnModels(options: {scope: () => Scope | null; turnIds: () => readonly string[]; read?: typeof readTurnModel}) {
  const profiles = shallowRef<Readonly<Record<string, string | null>>>({});
  const requests = new Map<string, Request>();
  const retries = new Set<ReturnType<typeof setTimeout>>();
  let scope: Scope | null = null; let active = 0; let stopped = false;
  function reset() {
    for (const request of requests.values()) request.controller.abort();
    requests.clear(); retries.forEach(clearTimeout); retries.clear(); profiles.value = {};
  }
  async function load(id: string, request: Request, current: Scope) {
    active++; request.pending = true; request.attempts++;
    let retry = false;
    try {
      const value = await (options.read ?? readTurnModel)(current.contextId, current.sessionId, id, request.controller.signal);
      if (request.controller.signal.aborted || requests.get(id) !== request) return;
      profiles.value = {...profiles.value, [id]: value.profileId}; request.done = true;
    } catch {
      if (request.controller.signal.aborted || requests.get(id) !== request) return;
      retry = request.attempts < 3;
      if (!retry) { profiles.value = {...profiles.value, [id]: null}; request.done = true; }
    } finally {
      active--;
      if (retry && !request.controller.signal.aborted) {
        const timer = setTimeout(() => {retries.delete(timer); request.pending = false; pump();}, request.attempts * 500);
        retries.add(timer);
      }
      pump();
    }
  }
  function pump() {
    if (stopped || !scope) return;
    for (const [id, request] of requests) {
      if (active >= 2) break;
      if (!request.pending && !request.done) void load(id, request, scope);
    }
  }
  watch(() => ({scope: options.scope(), ids: options.turnIds()}), value => {
    if (scope?.contextId !== value.scope?.contextId || scope?.sessionId !== value.scope?.sessionId) reset();
    scope = value.scope;
    if (!scope) return;
    const ids = new Set(value.ids);
    for (const [id, request] of requests) if (!ids.has(id)) {request.controller.abort(); requests.delete(id);}
    for (const id of [...value.ids].reverse()) if (!requests.has(id)) requests.set(id, {controller:new AbortController(),pending:false,done:false,attempts:0});
    pump();
  }, {immediate:true});
  onScopeDispose(() => {stopped = true; reset();});
  return computed(() => profiles.value);
}
