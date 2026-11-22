import { computed, ref, watch } from "vue";
import {
  chatModelClient, chatModelsEnabled, kimiK31Candidate,
  type Catalog, type ModelIntent, type ModelState, type ProfileId,
} from "../api/chat-model-client";
import { CHAT_COMPOSER_DEFAULT_PROFILE } from "../domain/chat-composer-draft";

type PendingSwitch = { target: string; intent: ModelIntent; operationId: string; recoveryAvailable?: boolean };

export function useChatModels(
  context: () => string | null,
  target: () => string | null,
  busy: () => boolean,
  newDraft?: { get: () => ProfileId; set: (profile: ProfileId) => void },
) {
  const catalog = ref<Catalog | null>(null);
  const state = ref<ModelState | null>(null);
  const loading = ref(false), saving = ref(false), error = ref(""), notice = ref("");
  const localNewProfile = ref<ProfileId>(CHAT_COMPOSER_DEFAULT_PROFILE);
  const newProfile = computed({
    get: () => newDraft?.get() ?? localNewProfile.value,
    set: (id: ProfileId) => { if (newDraft) newDraft.set(id); else localNewProfile.value = id; },
  });
  let epoch = 0;
  let pending: PendingSwitch | null = null;
  const profile = computed(() => target() === null ? newProfile.value : state.value?.profileId ?? null);
  const available = computed(() => catalog.value?.models.some(m => m.profile.profile_id === profile.value && m.available));
  const selectionLocked = computed(() => kimiK31Candidate && target() !== null && state.value?.state !== "ready");
  const readiness = computed(() => {
    if (!chatModelsEnabled) return "ready";
    if (error.value || !available.value || (target() !== null && state.value?.state !== "ready")) return "unavailable";
    return loading.value || saving.value ? "pending" : "ready";
  });
  const ready = computed(() => readiness.value === "ready");
  const intent = computed<ModelIntent | undefined>(() => chatModelsEnabled && ready.value && profile.value
    ? Object.freeze({ profileId: profile.value, expectedRevision: target() === null ? 0 : state.value?.revision ?? 0 })
    : undefined);
  const retryLabel = computed(() => kimiK31Candidate ? (state.value?.pending?.recoveryAvailable ? "继续切换" : "刷新状态") : "重试");

  function label(id: ProfileId | null) {
    return catalog.value?.models.find(m => m.profile.profile_id === id)?.profile.label;
  }

  function acceptState(session: string | null, value: ModelState | null) {
    state.value = value;
    const op = value?.pending;
    pending = session && op ? {
      target: session, operationId: op.operationId, recoveryAvailable: op.recoveryAvailable,
      intent: { profileId: op.profileId, expectedRevision: op.expectedRevision },
    } : null;
    error.value = "";
    if (value && value.state !== "ready") {
      const name = op && label(op.profileId);
      error.value = op?.recoveryAvailable && name
        ? `暂时无法确认当前模型。你可以继续切换到 ${name}。`
        : "暂时无法确认当前模型，请刷新状态。";
    }
  }

  function requireStateRead() {
    if (kimiK31Candidate) pending = null;
    if (state.value) state.value = { ...state.value, state: "unknown", pending: null };
  }

  async function refresh() {
    if (saving.value) return;
    const ctx = context(), session = target(), current = ++epoch;
    error.value = ""; notice.value = "";
    if (!chatModelsEnabled || !ctx) { catalog.value = null; acceptState(session, null); return; }
    loading.value = true;
    try {
      const c = await chatModelClient.catalog(ctx);
      const s = session ? await chatModelClient.state(ctx, session) : null;
      if (current !== epoch || context() !== ctx || target() !== session) return;
      catalog.value = c;
      acceptState(session, s);
    } catch {
      if (current === epoch) {
        if (kimiK31Candidate) requireStateRead();
        error.value = "暂时无法读取模型，请刷新重试。";
      }
    } finally {
      if (current === epoch) loading.value = false;
    }
  }

  async function applySwitch(ctx: string, request: PendingSwitch, recover: boolean) {
    const session = request.target, current = ++epoch;
    const isCurrent = () => current === epoch && context() === ctx && target() === session;
    saving.value = true; error.value = ""; notice.value = "";
    try {
      const action = recover ? chatModelClient.recover : chatModelClient.select;
      const result = await action(ctx, session, request.intent, request.operationId);
      if (isCurrent()) acceptState(session, result);
    } catch {
      if (!isCurrent()) return;
      requireStateRead();
      error.value = kimiK31Candidate ? "暂时无法确认当前模型，请刷新状态。" : "模型切换未完成，请重试。";
      if (kimiK31Candidate) {
        // The reply may be lost after commit. A read reconciles the original
        // operation without applying it again or advancing its revision.
        try {
          const result = await chatModelClient.state(ctx, session);
          if (!isCurrent()) return;
          acceptState(session, result);
          if (result.state === "ready" && result.profileId !== request.intent.profileId) {
            const name = label(result.profileId);
            notice.value = name ? `未能切换到所选模型，当前使用 ${name}。` : "未能切换到所选模型，请重新选择。";
          }
        } catch { /* Keep the unresolved selection blocked until a successful read. */ }
      }
    } finally {
      if (current === epoch) saving.value = false;
    }
  }

  async function select(id: ProfileId) {
    const ctx = context(), session = target();
    if (!ctx || busy() || saving.value || loading.value || selectionLocked.value ||
        !catalog.value?.models.some(m => m.profile.profile_id === id && m.available)) return;
    if (pending && pending.intent.profileId !== id) return;
    if (!session) { newProfile.value = id; error.value = ""; notice.value = ""; return; }
    if (id === profile.value && state.value?.state === "ready") return;
    pending ??= { target: session, intent: { profileId: id, expectedRevision: state.value?.revision ?? 0 }, operationId: crypto.randomUUID() };
    await applySwitch(ctx, pending, false);
  }

  async function retry() {
    if (!kimiK31Candidate) {
      if (pending) await select(pending.intent.profileId); else await refresh();
      return;
    }
    const ctx = context();
    if (!ctx || !pending?.recoveryAvailable) { await refresh(); return; }
    if (!busy() && !saving.value && !loading.value && pending.target === target()) await applySwitch(ctx, pending, true);
  }

  watch([context, target], ([ctx], [oldCtx]) => {
    epoch++; state.value = null; saving.value = false; loading.value = false; pending = null;
    if (ctx !== oldCtx && !newDraft) newProfile.value = CHAT_COMPOSER_DEFAULT_PROFILE;
    void refresh();
  }, { immediate: true });
  watch(busy, (value, previous) => { if (previous && !value) void refresh(); });
  return { catalog, state, profile, loading, saving, error, notice, selectionLocked, readiness, ready, intent, refresh, select, retry, retryLabel,
    resetNew: () => { newProfile.value = CHAT_COMPOSER_DEFAULT_PROFILE; } };
}
