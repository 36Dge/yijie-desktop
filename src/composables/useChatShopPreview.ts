import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { PREVIEW_SHOPS, SHOP_PREVIEW_TIMING, type ShopPreviewScenario, type ShopPreviewStage } from "../domain/chat-shop-preview";

/** A local interaction prototype: no API, IPC, credentials, storage or chat payloads. */
export function useChatShopPreview(authority: () => string | null, target: () => string) {
  const authorized = ref(false);
  const stage = ref<ShopPreviewStage>("empty");
  const associations = shallowRef<Record<string, string>>({});
  const expiredIds = ref<string[]>([]);
  const expiredName = ref("");
  const draftId = ref<string | null>(null);
  const query = ref("");
  const platform = ref<"all" | "TikTok Shop" | "Amazon">("all");
  const authorizationStep = ref(0), refreshing = ref(false), notice = ref("");
  const scopeRevision = ref(0);
  let retryAction: "authorization" | "refresh" = "authorization";
  let timers: ReturnType<typeof setTimeout>[] = [];
  let epoch = 0;
  const current = computed(() => PREVIEW_SHOPS.find(shop => shop.id === associations.value[target()] && !expiredIds.value.includes(shop.id)) ?? null);
  const available = computed(() => authorized.value ? PREVIEW_SHOPS.filter(shop => !expiredIds.value.includes(shop.id)) : []);
  const filtered = computed(() => available.value.filter(shop =>
    (platform.value === "all" || shop.platform === platform.value) &&
    `${shop.name} ${shop.platform} ${shop.market}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ));
  const chosen = computed(() => available.value.find(shop => shop.id === draftId.value) ?? null);
  const busy = computed(() => stage.value === "authorizing" || stage.value === "linking" || refreshing.value);

  function clearTimers() { epoch++; timers.forEach(clearTimeout); timers = []; refreshing.value = false; }
  function later(callback: () => void, delay: number) {
    const currentEpoch = epoch;
    timers.push(setTimeout(() => { if (epoch === currentEpoch) callback(); }, delay));
  }
  function showList() {
    clearTimers(); stage.value = authorized.value ? "list" : "empty";
    draftId.value = current.value?.id ?? null; query.value = ""; platform.value = "all";
  }
  function openPanel() { if (stage.value !== "expired" && stage.value !== "error") showList(); notice.value = ""; }
  function cancel() {
    if (busy.value) showList();
    else draftId.value = current.value?.id ?? null;
  }
  function authorize() {
    clearTimers(); retryAction = "authorization"; stage.value = "authorizing"; authorizationStep.value = 0; notice.value = "";
    later(() => { authorizationStep.value = 1; }, SHOP_PREVIEW_TIMING.authorizationStep);
    later(() => {
      authorized.value = true; expiredIds.value = []; expiredName.value = "";
      showList(); notice.value = "授权完成，已找到 5 家示例店铺。";
    }, SHOP_PREVIEW_TIMING.authorization);
  }
  function choose(id: string) {
    if (!busy.value && available.value.some(shop => shop.id === id)) draftId.value = id;
  }
  function link() {
    const shop = chosen.value;
    if (!shop || busy.value || shop.id === current.value?.id) return;
    clearTimers(); const key = target(); stage.value = "linking";
    later(() => {
      if (target() !== key) return;
      associations.value = { ...associations.value, [key]: shop.id };
      stage.value = "success"; notice.value = `已关联 ${shop.name}。`;
    }, SHOP_PREVIEW_TIMING.linking);
  }
  function unlink() {
    if (busy.value) return;
    const next = { ...associations.value }; delete next[target()]; associations.value = next;
    showList(); notice.value = "已解除当前对话的店铺关联，店铺授权仍保留。";
  }
  function refresh() {
    if (!authorized.value || busy.value) return;
    clearTimers(); retryAction = "refresh"; refreshing.value = true; notice.value = "";
    later(() => { refreshing.value = false; notice.value = "店铺状态已更新。"; }, SHOP_PREVIEW_TIMING.refresh);
  }
  function retry() { if (retryAction === "authorization") authorize(); else { showList(); refresh(); } }
  function reset() {
    scopeRevision.value++;
    clearTimers(); authorized.value = false; associations.value = {}; expiredIds.value = [];
    expiredName.value = ""; stage.value = "empty"; draftId.value = null; notice.value = "";
    query.value = ""; platform.value = "all";
  }
  function adoptNewChat(sessionId: string) {
    const id = associations.value.new;
    if (!id || target() !== "new") return;
    const next = { ...associations.value, [sessionId]: id }; delete next.new; associations.value = next;
  }
  // Used by isolated UI review fixtures; deliberately absent from product controls.
  function previewScenario(scenario: ShopPreviewScenario) {
    clearTimers(); notice.value = "";
    if (scenario === "authorization-error" || scenario === "list-error") {
      if (scenario === "list-error") authorized.value = true;
      retryAction = scenario === "authorization-error" ? "authorization" : "refresh";
      stage.value = "error"; return;
    }
    authorized.value = true;
    const ids = scenario === "expired-current" ? [current.value?.id ?? PREVIEW_SHOPS[0]!.id] : PREVIEW_SHOPS.filter(shop => shop.id !== current.value?.id).slice(-2).map(shop => shop.id);
    expiredName.value = PREVIEW_SHOPS.find(shop => shop.id === ids[0])!.name;
    expiredIds.value = ids;
    associations.value = Object.fromEntries(Object.entries(associations.value).filter(([, id]) => !ids.includes(id)));
    showList(); stage.value = scenario === "expired-current" ? "expired" : "list";
  }
  watch(authority, reset);
  watch(target, () => { scopeRevision.value++; showList(); notice.value = ""; });
  onBeforeUnmount(clearTimers);
  return { authorized, stage, current, available, filtered, expiredIds, expiredName, draftId, chosen, query, platform, authorizationStep, refreshing, notice, busy, scopeRevision, openPanel, showList, authorize, choose, link, unlink, refresh, retry, cancel, reset, adoptNewChat, previewScenario };
}

export type ChatShopPreview = ReturnType<typeof useChatShopPreview>;
