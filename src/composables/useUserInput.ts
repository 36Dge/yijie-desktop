import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { userInputClient, type UserInputAnswers, type UserInputRequest } from "../api/user-input-client";
import { ChatClientError } from "../domain/chat-ipc";
import type { UserInputDraftScope } from "../domain/user-input-draft-scope";

const REVALIDATION_LIMIT_MS = 60_000;

export function useUserInput(context: () => string | null, session: () => string | null, canAnswer: () => boolean, draftScope?: () => UserInputDraftScope | null) {
  const current = shallowRef<UserInputRequest | null>(null);
  const formKey = ref(0), revalidating = ref(false);
  const connected = ref(false), submitting = ref(false), loading = ref(false);
  const error = ref<string | null>(null), notice = ref<string | null>(null);
  const uncertain = ref<string | null>(null);
  let epoch = 0, mutation = 0, readSequence = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let touching: { id: string; epoch: number; mutation: number } | null = null;
  let runtimeGeneration: string | null = null;
  let scopeTimer: ReturnType<typeof setTimeout> | null = null;
  let retentionTimer: ReturnType<typeof setTimeout> | null = null;
  let retained: { generation: string; definition: string; id: string } | null = null;
  const definition = (r: UserInputRequest) => JSON.stringify([r.turn_id, r.item_id, r.questions]);
  const scope = () => {
    const value = draftScope?.();
    return value && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() ? value : null;
  };
  const scopeAllowed = () => !draftScope || scope() !== null;
  function clearRetention(discardDraft: boolean) {
    if (retentionTimer) clearTimeout(retentionTimer);
    retentionTimer = null; retained = null; revalidating.value = false;
    if (discardDraft) formKey.value++;
  }
  function holdDraft(r: UserInputRequest) {
    revalidating.value = true;
    if (retained) return;
    retained = { generation: runtimeGeneration!, definition: definition(r), id: r.request_id };
    retentionTimer = setTimeout(() => {
      // Local data cleanup only: no answer, timeout or turn cancellation is sent.
      epoch++; invalidateReads(); if (timer) clearTimeout(timer);
      clearRetention(true); current.value = null; connected.value = false;
      notice.value = "问题重新确认超时，未发送的回答已清除，请重新填写。";
      void poll(epoch);
    }, REVALIDATION_LIMIT_MS);
  }
  const blocked = computed(() => !connected.value || submitting.value || !!uncertain.value || revalidating.value || !canAnswer() || !scopeAllowed());
  const active = (r: UserInputRequest | null) => r?.state === "pending" || r?.state === "submitting";
  const missing = (e: unknown) => e instanceof ChatClientError && e.shape.code === "chat_resource_not_found";
  function invalidateReads() { mutation++; readSequence++; loading.value = false; }
  function accept(r: UserInputRequest) {
    const previous = current.value;
    if (previous?.request_id === r.request_id &&
      ((!active(previous) && previous.state !== r.state) || (previous.state === "submitting" && r.state === "pending"))) return;
    if (previous && (previous.request_id !== r.request_id || definition(previous) !== definition(r))) formKey.value++;
    current.value = r;
    if (r.state === "pending") { notice.value = null; return; }
    const messages: Record<string, string> = { answered: "回答已发送", skipped: "已跳过问题", timed_out: "已超时，按未回答继续", cancelled: "问题已结束", unknown: "回答结果尚未确认，请查看原任务状态。" };
    notice.value = messages[r.state] ?? null;
  }
  async function refresh(generation = epoch) {
    const c = context(), s = session();
    if (!c || !s || disposed || generation !== epoch || submitting.value || !scopeAllowed()) return;
    const revision = mutation, sequence = ++readSequence;
    const valid = () => !disposed && generation === epoch && revision === mutation && sequence === readSequence && scopeAllowed();
    loading.value = true;
    try {
      const snapshot = await userInputClient.snapshot(c, s);
      if (!valid()) return;
      if (retained) {
        const same = snapshot.requests.find(r => r.request_id === retained?.id);
        const confirmed = snapshot.enabled && snapshot.generation === retained.generation &&
          same?.state === "pending" && definition(same) === retained.definition && canAnswer();
        clearRetention(!confirmed);
      }
      connected.value = snapshot.enabled; error.value = null;
      if (runtimeGeneration && snapshot.generation && runtimeGeneration !== snapshot.generation) {
        const hadRequest = active(current.value) || !!uncertain.value;
        current.value = null; uncertain.value = null;
        if (hadRequest) notice.value = "会话连接已更新，旧问题不能继续回答。";
      }
      runtimeGeneration = snapshot.generation ?? runtimeGeneration;
      const id = uncertain.value ?? (active(current.value) ? current.value?.request_id : null);
      const sameRequest = snapshot.requests.find(r => r.request_id === id);
      const pending = sameRequest ?? snapshot.requests[0];
      if (pending && pending.request_id !== id) {
        const previousUnknown = !!uncertain.value;
        uncertain.value = null; accept(pending);
        if (previousUnknown) notice.value = "上一条回答结果未确认；当前显示的是新的问题。";
        return;
      }
      let readOriginal = false;
      if (id && (!sameRequest || uncertain.value)) {
        try {
          const receipt = await userInputClient.read(c, s, id);
          if (!valid()) return;
          accept(receipt); readOriginal = true;
          if (receipt.state !== "submitting") uncertain.value = null;
        } catch (failure: unknown) {
          if (!valid()) return;
          if (!sameRequest && missing(failure)) {
            // Current snapshot + correlated 404 establishes non-actionability,
            // not whether an old answer was consumed. Never replay it.
            current.value = null; uncertain.value = null;
            notice.value = "原问题已不再待答，历史回答结果暂时无法确认。";
            return;
          }
          throw failure;
        }
      }
      if (pending && !uncertain.value && !readOriginal) accept(pending);
      else if (!id && !pending) current.value = null;
    } catch (failure: unknown) {
      if (valid()) {
        if (failure instanceof ChatClientError && ["chat_context_invalid", "chat_capability_denied"].includes(failure.shape.code)) {
          clearRetention(true); current.value = null;
        }
        connected.value = false; error.value = "暂时无法同步问题或回答回执，请重新读取。";
      }
    } finally { if (valid()) loading.value = false; }
  }
  async function poll(generation: number) {
    await refresh(generation);
    if (!disposed && generation === epoch && context() && session() && scopeAllowed()) timer = setTimeout(() => void poll(generation), 1500);
  }
  watch([context, session, () => scope()?.key ?? null, canAnswer], (next, previous) => {
    const r = current.value;
    const retain = !!draftScope && !!scope() && !!runtimeGeneration && r?.state === "pending" &&
      !submitting.value && !uncertain.value && previous?.[1] === next[1] && previous?.[2] === next[2] &&
      (!next[0] || canAnswer());
    epoch++; invalidateReads(); if (timer) clearTimeout(timer);
    if (retain) holdDraft(r);
    else { clearRetention(true); current.value = null; runtimeGeneration = null; }
    connected.value = false; submitting.value = false; error.value = null; notice.value = null;
    uncertain.value = null; touching = null;
    void poll(epoch);
  }, { immediate: true, flush: "sync" });
  watch(() => draftScope?.()?.expiresAt ?? null, deadline => {
    if (scopeTimer) clearTimeout(scopeTimer);
    scopeTimer = null;
    if (deadline === null) return;
    scopeTimer = setTimeout(() => {
      if (scopeAllowed()) return;
      epoch++; invalidateReads(); if (timer) clearTimeout(timer);
      clearRetention(true); current.value = null; connected.value = false; uncertain.value = null;
    }, Math.max(0, deadline - Date.now()));
  }, { immediate: true, flush: "sync" });
  async function touch() {
    const c = context(), s = session(), r = current.value;
    if (!c || !s || !r || !scopeAllowed() || blocked.value || r.state !== "pending" || r.timeout_paused || !r.deadline_at || touching?.id === r.request_id) return;
    invalidateReads();
    const token = { id: r.request_id, epoch, mutation }; touching = token;
    const valid = () => !disposed && token.epoch === epoch && token.mutation === mutation && current.value?.request_id === token.id && current.value.state === "pending";
    try {
      const result = await userInputClient.touch(c, s, r.request_id);
      if (valid()) accept(result);
    } catch { if (valid()) error.value = "倒计时暂停尚未确认，请重新读取。"; }
    finally {
      if (touching === token) touching = null;
      // A late touch must not invalidate the answer's newer receipt read.
      if (!disposed && token.epoch === epoch && token.mutation === mutation && current.value?.request_id === token.id) invalidateReads();
    }
  }
  async function answer(answers: UserInputAnswers) {
    const c = context(), s = session(), r = current.value;
    if (!c || !s || !r || !scopeAllowed() || r.state !== "pending" || blocked.value) return;
    invalidateReads();
    const generation = epoch, revision = mutation;
    const valid = () => !disposed && generation === epoch && revision === mutation;
    submitting.value = true; error.value = null; notice.value = null;
    const operationId = crypto.randomUUID();
    try {
      const result = await userInputClient.answer(c, s, r.request_id, { operation_id: operationId, answers });
      if (valid()) { accept(result); uncertain.value = result.state === "submitting" ? r.request_id : null; }
    } catch {
      if (valid()) { uncertain.value = r.request_id; connected.value = false; error.value = "回答是否送达尚未确认，正在读取原请求回执。"; }
    } finally {
      if (valid()) { submitting.value = false; invalidateReads(); void refresh(generation); }
    }
  }
  onBeforeUnmount(() => { disposed = true; epoch++; invalidateReads(); if (timer) clearTimeout(timer); if (scopeTimer) clearTimeout(scopeTimer); clearRetention(true); current.value = null; });
  return { current, formKey, revalidating, connected, submitting, loading, error, notice, blocked, touch, answer, refresh: () => refresh(), dismissNotice: () => { notice.value = null; } };
}
