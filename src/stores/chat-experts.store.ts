import { ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { expertNativeClient, ExpertClientError, type ExpertNativeClient } from "../api/expert-native-client";
import type { BindingView, BindingSetPayload, ExpertSelection, NativeSubmitPayload, NativeSubmissionResult } from "../domain/experts-v2.generated";
import { expertErrorMessage, expertSelection } from "../domain/expert-ui";

export type ExpertTurnIntent = Pick<NativeSubmitPayload, "expectedBindingRevision" | "expert">;
export function bindingTurnIntent(view: BindingView | null | undefined): ExpertTurnIntent | undefined {
  return view?.managed ? { expectedBindingRevision: view.bindingRevision, expert: view.expert ? expertSelection(view.expert) : null } : undefined;
}
const unsettled = (view: BindingView) => view.state === "applying" || view.state === "unknown";
const same = (a: ExpertSelection | null, b: ExpertSelection | null) => a === null ? b === null : b !== null && a.expertId === b.expertId && a.version === b.version;

/** Native is the binding authority. Only original in-flight intents live here. */
export function createChatExpertsStoreDefinition(client: ExpertNativeClient, id = "chat-experts") {
  return defineStore(id, () => {
    const contextId = ref<string | null>(null), scope = ref<string | null>(null);
    const bindings = shallowRef<Readonly<Record<string, BindingView>>>({});
    const errors = shallowRef<Readonly<Record<string, string>>>({});
    const busy = shallowRef<ReadonlySet<string>>(new Set());
    const pending = shallowRef<Readonly<Record<string, BindingSetPayload>>>({});
    const submissions = shallowRef<Readonly<Record<string, NativeSubmitPayload>>>({});
    const acceptedSubmissions = shallowRef<Readonly<Record<string, NativeSubmissionResult>>>({});
    let epoch = 0;
    function clear() { epoch++; contextId.value = null; scope.value = null; bindings.value = {}; errors.value = {}; busy.value = new Set(); pending.value = {}; submissions.value = {}; acceptedSubmissions.value = {}; }
    function bind(context: string | null, authorityScope: string | null) {
      if (!authorityScope) { clear(); return; }
      if (scope.value !== authorityScope) { clear(); scope.value = authorityScope; }
      if (contextId.value !== context) { epoch++; contextId.value = context; bindings.value = {}; busy.value = new Set(); errors.value = {}; }
    }
    function setBusy(session: string, value: boolean) { const next = new Set(busy.value); if (value) next.add(session); else next.delete(session); busy.value = next; }
    function error(session: string, value: string | null) { const next = { ...errors.value }; if (value) next[session] = value; else delete next[session]; errors.value = next; }
    async function refresh(session: string): Promise<void> {
      const context = contextId.value, generation = epoch;
      if (!context || busy.value.has(session)) return;
      setBusy(session, true);
      try {
        const operationId = pending.value[session]?.operationId ?? bindings.value[session]?.operationId;
        const result = operationId ? await client.bindingOperation(context, session, operationId) : null;
        const next = result?.binding ?? await client.binding(context, session);
        if (generation !== epoch) return;
        const original = pending.value[session];
        if (result && original && (result.operation.expectedBindingRevision !== original.expectedBindingRevision || !same(result.operation.requestedExpert, original.expert))) throw new ExpertClientError("outcome_unknown");
        bindings.value = { ...bindings.value, [session]: next };
        if (result && ["succeeded", "rejected"].includes(result.operation.state)) { const values = { ...pending.value }; delete values[session]; pending.value = values; }
        error(session, next.errorCode ? expertErrorMessage(next.errorCode) : unsettled(next) ? expertErrorMessage("operation_pending") : null);
      } catch (failure) {
        if (generation === epoch) error(session, expertErrorMessage(failure instanceof ExpertClientError ? failure.code : "binding_unavailable"));
      } finally { if (generation === epoch) setBusy(session, false); }
    }
    async function select(session: string, expert: ExpertSelection | null): Promise<boolean> {
      const context = contextId.value, current = bindings.value[session], generation = epoch;
      if (!context || !current || busy.value.has(session) || (errors.value[session] && !(current.state === "unavailable" && expert === null)) || pending.value[session] || unsettled(current) || submissions.value[session]) return false;
      if (same(current.expert, expert)) return true;
      const payload: BindingSetPayload = { operationId: crypto.randomUUID(), sessionId: session, expectedBindingRevision: current.bindingRevision, expert: expert ? expertSelection(expert) : null };
      pending.value = { ...pending.value, [session]: payload }; setBusy(session, true); error(session, null);
      // Keep the effective old expert until Native confirms the new revision.
      bindings.value = { ...bindings.value, [session]: { ...current, state: "applying", operationId: payload.operationId } };
      try {
        const result = await client.setBinding(context, payload);
        if (generation !== epoch) return false;
        bindings.value = { ...bindings.value, [session]: result.binding };
        if (["succeeded", "rejected"].includes(result.operation.state)) { const values = { ...pending.value }; delete values[session]; pending.value = values; }
        error(session, result.operation.errorCode ? expertErrorMessage(result.operation.errorCode) : unsettled(result.binding) ? expertErrorMessage("operation_pending") : null);
        return result.operation.state === "succeeded";
      } catch (failure) {
        if (generation !== epoch) return false;
        const code = failure instanceof ExpertClientError ? failure.code : "outcome_unknown";
        const unknown = ["outcome_unknown", "operation_pending", "temporarily_unavailable"].includes(code);
        if (!unknown) { const values = { ...pending.value }; delete values[session]; pending.value = values; }
        bindings.value = { ...bindings.value, [session]: unknown ? { ...current, state: "unknown", operationId: payload.operationId } : current };
        error(session, expertErrorMessage(code));
        return false;
      } finally { if (generation === epoch) setBusy(session, false); }
    }
    async function recover(session: string, operationId: string): Promise<boolean> {
      const context = contextId.value, generation = epoch, current = bindings.value[session], original = pending.value[session];
      if (!context || !current || busy.value.has(session) || submissions.value[session] || !unsettled(current) || (original?.operationId ?? current.operationId) !== operationId) return false;
      setBusy(session, true); error(session, null);
      try {
        const result = await client.recoverBinding(context, session, operationId);
        if (generation !== epoch) return false;
        if (original && (result.operation.expectedBindingRevision !== original.expectedBindingRevision || !same(result.operation.requestedExpert, original.expert))) throw new ExpertClientError("outcome_unknown");
        bindings.value = { ...bindings.value, [session]: result.binding };
        if (["succeeded", "rejected"].includes(result.operation.state)) { const values = { ...pending.value }; delete values[session]; pending.value = values; }
        error(session, result.operation.errorCode ? expertErrorMessage(result.operation.errorCode) : unsettled(result.binding) ? expertErrorMessage("operation_pending") : null);
        return result.operation.state === "succeeded";
      } catch (failure) {
        // A recovery guard/transport error is not a verdict on the original apply.
        if (generation === epoch) error(session, expertErrorMessage(failure instanceof ExpertClientError ? failure.code : "outcome_unknown"));
        return false;
      } finally { if (generation === epoch) setBusy(session, false); }
    }
    async function submit(context: string, payload: NativeSubmitPayload) {
      const target = payload.submission.sessionId ?? "new", prior = submissions.value[target], generation = epoch;
      if (context !== contextId.value) throw new ExpertClientError("context_invalid");
      if (prior && JSON.stringify(prior) !== JSON.stringify(payload)) throw new ExpertClientError("operation_pending");
      const accepted = acceptedSubmissions.value[target];
      if (prior && accepted) return accepted;
      // Freeze the complete original wrapper before I/O; unknown is never a new send.
      const original = prior ?? JSON.parse(JSON.stringify(payload)) as NativeSubmitPayload;
      submissions.value = { ...submissions.value, [target]: original };
      try {
        const result = await client.submit(context, original);
        if (generation !== epoch) throw new ExpertClientError("outcome_unknown");
        // A route change may prevent the caller from consuming its draft. Keep
        // both the original request and receipt until that caller acknowledges
        // it, so returning to the draft cannot turn acceptance into a new send.
        acceptedSubmissions.value = { ...acceptedSubmissions.value, [target]: result };
        bindings.value = { ...bindings.value, [result.receipt.sessionId]: { sessionId: result.receipt.sessionId, managed: true, bindingRevision: result.bindingRevision, expert: result.expert, state: result.expert ? "ready" : "none" } };
        return result;
      } catch (failure) {
        // A typed definitive rejection is safe to edit. Unknown retains every byte.
        if (generation === epoch && !prior && failure instanceof ExpertClientError && !["outcome_unknown", "operation_pending", "temporarily_unavailable"].includes(failure.code)) {
          const next = { ...submissions.value }; delete next[target]; submissions.value = next;
        }
        throw failure;
      }
    }
    function acknowledgeSubmission(operationId: string): void {
      const target = Object.keys(submissions.value).find(key => submissions.value[key]?.submission.operationId === operationId && acceptedSubmissions.value[key]?.receipt.submissionOperationId === operationId);
      if (!target) return;
      const next = { ...submissions.value }; delete next[target]; submissions.value = next;
      const accepted = { ...acceptedSubmissions.value }; delete accepted[target]; acceptedSubmissions.value = accepted;
    }
    return { contextId, scope, bindings, errors, busy, pending, submissions, bind, clear, refresh, select, recover, submit, acknowledgeSubmission };
  });
}
export const useChatExpertsStore = createChatExpertsStoreDefinition(expertNativeClient);
