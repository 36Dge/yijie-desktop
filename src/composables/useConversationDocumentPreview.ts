import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, useTemplateRef } from "vue";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { documentPreviewClient, DocumentPreviewError } from "../api/chat-document-preview-client";
import type { Document as PreviewDocument, Invalidated, Loaded, Viewport } from "../domain/document-preview.generated";
import { addPreviewTab, closePreviewTab, isSidebarFile, openPreviewFile, previewFailure, previewWidths, type PreviewFile, type PreviewTab, type PreviewTabs } from "../domain/conversation-file-preview";

export function useConversationDocumentPreview(props: Readonly<{ contextId: string | null; scopeKey: string; enabled: boolean }>, emit: { (event: "expanded", value: boolean): void; (event: "restoreTrigger"): void }) {
const root = useTemplateRef<HTMLElement>("root");
const panel = useTemplateRef<HTMLElement>("panel");
const viewport = useTemplateRef<HTMLElement>("viewport");
const tabStrip = useTemplateRef<HTMLElement>("tabStrip");
const addButton = useTemplateRef<HTMLButtonElement>("addButton");
const separator = useTemplateRef<HTMLElement>("separator");
const opened = ref(false);
const width = ref(0);
const preferred = ref<number | null>(null);
const state = reactive<PreviewTabs>({ tabs: [], activeId: null });
const active = computed(() => state.tabs.find(t => t.id === state.activeId) ?? null);
const geometry = computed(() => previewWidths(width.value, preferred.value));
const metadata = ref<PreviewDocument | null>(null);
const phase = ref<"empty" | "loading" | "ready" | "error" | "paused">("empty");
const error = ref<ReturnType<typeof previewFailure> | null>(null);
const notice = ref("");
const dragging = ref(false);
let drag: { start: number; width: number; preference: number | null; pointerId: number } | null = null;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let themeObserver: MutationObserver | undefined;
let unlisteners: UnlistenFn[] = [];
let disposed = false;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let frame = 0;
let inFlight = false;
let queued: { tab: PreviewTab; epoch: number; context: string } | null = null;
let current: { id: string; context: string; tab: PreviewTab; loaded: boolean } | null = null;
const closeTasks = new Set<Promise<void>>();
const newId = () => crypto.randomUUID();
const capacityText = "最多打开10个标签页，请先关闭一个";

function measuredViewport(): Viewport | null {
  const r = viewport.value?.getBoundingClientRect();
  return r && r.width >= 1 && r.height >= 1 ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 } : null;
}
function overlayVisible(): boolean {
  return [...document.querySelectorAll<HTMLElement>('.n-modal-container,.n-dropdown-menu,.n-popover,[aria-modal="true"],dialog[open]')].some(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden");
}
function syncViewport() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const view = current; const bounds = measuredViewport();
    if (!view || !bounds || disposed) return;
    void documentPreviewClient.run(view.context, { action: "resize", viewId: view.id, viewport: bounds, visible: opened.value && !dragging.value && !overlayVisible() && document.visibilityState !== "hidden" && phase.value === "ready" }).catch(() => {});
  });
}
function detach(preserve: boolean): Promise<void> {
  const view = current; current = null;
  metadata.value = null;
  clearTimeout(timer); clearTimeout(deadline);
  if (!view) return Promise.resolve();
  const task = (async () => {
    const bounds = measuredViewport();
    if (bounds) await documentPreviewClient.run(view.context, { action: "resize", viewId: view.id, viewport: bounds, visible: false }).catch(() => {});
    if (preserve && view.loaded) {
      try {
        const value = await documentPreviewClient.run(view.context, { action: "position", viewId: view.id });
        if (value.position && state.tabs.includes(view.tab)) view.tab.location = { ...view.tab.location, ...value.position };
      } catch { /* A revoked view must still close normally. */ }
    }
    try { await documentPreviewClient.run(view.context, { action: "close", viewId: view.id }); } catch { /* Native expiry may already have released it. */ }
  })();
  closeTasks.add(task); void task.finally(() => closeTasks.delete(task)); return task;
}
function loaded() {
  if (!current?.loaded || !metadata.value || !opened.value || phase.value === "error") return;
  clearTimeout(timer); phase.value = "ready"; syncViewport();
}
async function pump() {
  if (inFlight || disposed || !queued) return;
  inFlight = true;
  const job = queued; queued = null;
  const viewId = newId();
  try {
    await Promise.all([...closeTasks]); await nextTick();
    if (job.epoch !== epoch || !opened.value || !job.tab.file) return;
    const bounds = measuredViewport(); if (!bounds) throw new DocumentPreviewError("artifact_native_unavailable");
    const view = { id: viewId, context: job.context, tab: job.tab, loaded: false }; current = view;
    const result = await documentPreviewClient.run(job.context, { action: "open", viewId, source: job.tab.file.source, viewport: bounds, location: job.tab.location, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
    if (job.epoch !== epoch || disposed || current !== view || !opened.value) {
      await documentPreviewClient.run(job.context, { action: "close", viewId }).catch(() => {}); return;
    }
    if (!result.document) throw new DocumentPreviewError("artifact_native_unavailable");
    metadata.value = result.document;
    const same = job.tab.location.revision === null || job.tab.location.revision === result.document.revision;
    job.tab.location = { ...job.tab.location, section: result.document.section, offset: result.document.offset, revision: result.document.revision, scrollX: same ? job.tab.location.scrollX : 0, scrollY: same ? job.tab.location.scrollY : 0 };
    const remaining = result.document.expiresAt * 1000 - Date.now();
    if (remaining <= 0) throw new DocumentPreviewError("artifact_native_expired");
    deadline = setTimeout(() => invalidate("artifact_native_expired"), Math.min(remaining, 1_800_000));
    loaded();
  } catch (cause) {
    if (job.epoch === epoch && !disposed) invalidate(cause instanceof DocumentPreviewError ? cause.code : "artifact_native_unavailable");
  } finally { inFlight = false; if (queued) void pump(); }
}
function invalidate(code: string) {
  epoch++; queued = null; error.value = previewFailure(code); phase.value = "error"; void detach(false);
}
function reload(preserve = true) {
  const generation = ++epoch; queued = null;
  const closed = detach(preserve);
  error.value = null;
  const tab = active.value;
  if (!opened.value || !props.enabled || !props.contextId || !tab?.file) { phase.value = "empty"; return; }
  if (tab.file.status === "expired" || (tab.file.expiresAt !== null && tab.file.expiresAt <= Date.now() / 1000)) { invalidate("artifact_native_expired"); return; }
  phase.value = "loading";
  queued = { tab, epoch: generation, context: props.contextId };
  timer = setTimeout(() => { if (generation === epoch) invalidate("preview_timeout"); }, 15000);
  void closed.then(() => { if (generation === epoch) void pump(); });
}
function focusTab(id: string | null) {
  void nextTick(() => {
    const element = id ? tabStrip.value?.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`) : addButton.value;
    element?.focus(); element?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });
}
function ensureOpen(): boolean {
  if (!props.enabled) return false;
  if (!geometry.value.available) { notice.value = "窗口空间不足，请扩大窗口后打开文件预览"; return false; }
  notice.value = ""; opened.value = true; return true;
}
function openFile(file: PreviewFile) {
  if (!isSidebarFile(file.mediaType, file.name) || !ensureOpen()) return;
  const previous = active.value; const wasReady = phase.value === "ready" || phase.value === "loading";
  const tab = openPreviewFile(state, file, newId);
  if (!tab) { notice.value = capacityText; return; }
  if (tab !== previous || !wasReady || !current) reload();
  focusTab(tab.id);
}
function collapse(restore = true) {
  opened.value = false; epoch++; queued = null; phase.value = "empty"; endDrag(false); void detach(true);
  if (restore) emit("restoreTrigger");
}
function toggle() {
  if (opened.value) collapse(); else if (ensureOpen()) { reload(); if (active.value) focusTab(active.value.id); else void nextTick(() => addButton.value?.focus()); }
}
function createTab() {
  const tab = addPreviewTab(state, newId);
  if (!tab) { notice.value = capacityText; return; }
  notice.value = ""; reload(); focusTab(tab.id);
}
function selectTab(id: string) { if (state.activeId !== id) { state.activeId = id; reload(); } focusTab(id); }
function closeTab(id: string) {
  const wasActive = state.activeId === id;
  const focused = (document.activeElement as HTMLElement | null)?.closest("[data-preview-tab]")?.getAttribute("data-preview-tab") === id;
  closePreviewTab(state, id); notice.value = "";
  if (wasActive) { reload(false); focusTab(state.activeId); } else if (focused) focusTab(state.activeId);
}
function keyTab(event: KeyboardEvent, id: string) {
  const i = state.tabs.findIndex(t => t.id === id);
  let target: string | undefined;
  if (event.key === "ArrowRight") target = state.tabs[(i + 1) % state.tabs.length]?.id;
  if (event.key === "ArrowLeft") target = state.tabs[(i - 1 + state.tabs.length) % state.tabs.length]?.id;
  if (event.key === "Home") target = state.tabs[0]?.id;
  if (event.key === "End") target = state.tabs[state.tabs.length - 1]?.id;
  if (target) { event.preventDefault(); focusTab(target); }
  if (event.key === "Delete") { event.preventDefault(); closeTab(id); }
}
function navigate(section: number, offset: number, zoom = active.value?.location.zoom ?? 1) {
  if (!active.value) return;
  active.value.location = { ...active.value.location, section, offset, zoom, scrollX: 0, scrollY: 0 };
  reload(false);
}
function resetWidth() { preferred.value = null; syncViewport(); }
function keyResize(event: KeyboardEvent) {
  const g = geometry.value; const step = event.shiftKey ? 64 : 16;
  const value = ({ ArrowLeft: g.right + step, ArrowRight: g.right - step, Home: g.min, End: g.max })[event.key];
  if (event.key === "Enter") { event.preventDefault(); resetWidth(); }
  else if (value !== undefined) { event.preventDefault(); preferred.value = Math.max(g.min, Math.min(g.max, value)); }
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault(); separator.value?.focus();
  drag = { start: event.clientX, width: geometry.value.right, preference: preferred.value, pointerId: event.pointerId };
  dragging.value = true; separator.value?.setPointerCapture?.(event.pointerId); syncViewport();
}
function moveDrag(event: PointerEvent) { if (drag) preferred.value = Math.max(geometry.value.min, Math.min(geometry.value.max, drag.width + drag.start - event.clientX)); }
function endDrag(commit = true) {
  const previous = drag; drag = null; dragging.value = false;
  if (previous) { if (!commit) preferred.value = previous.preference; if (separator.value?.hasPointerCapture?.(previous.pointerId)) separator.value.releasePointerCapture(previous.pointerId); }
  syncViewport();
}
function cancelDrag() { if (drag) endDrag(false); }
function suspend() {
  cancelDrag(); epoch++; queued = null; void detach(true);
  phase.value = active.value?.file ? "paused" : "empty";
}
function visibility() {
  cancelDrag();
  if (document.visibilityState === "hidden") suspend();
  else if (opened.value) reload();
}
watch(opened, value => emit("expanded", value));
watch(() => geometry.value.right, () => { void nextTick(syncViewport); });
// Scope follows route + authenticated tenant/revision/capability. A short-lived
// Native context can renew within that same scope; release its content at once,
// then authorize/read again using the replacement context without losing tabs.
watch(() => props.scopeKey, () => { collapse(false); state.tabs = []; state.activeId = null; preferred.value = null; notice.value = ""; });
watch(() => [props.contextId, props.enabled], () => {
  if (!props.contextId || !props.enabled) suspend();
  else if (opened.value) reload();
});
onMounted(async () => {
  resizeObserver = new ResizeObserver(entries => {
    if (entries.some(e => e.target === root.value)) {
      const next = root.value?.getBoundingClientRect().width ?? 0;
      if (next !== width.value && drag) endDrag(false);
      width.value = next;
      if (!geometry.value.available && opened.value) { const focusHidden = panel.value?.contains(document.activeElement) || separator.value === document.activeElement; collapse(Boolean(focusHidden)); notice.value = "窗口空间不足，请扩大窗口后打开文件预览"; }
    }
    syncViewport();
  });
  if (root.value) { width.value = root.value.getBoundingClientRect().width; resizeObserver.observe(root.value); }
  mutationObserver = new MutationObserver(syncViewport); mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-modal", "hidden", "open"] });
  themeObserver = new MutationObserver(() => { if (opened.value) reload(); });
  themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", cancelDrag);
  try {
    const callbacks = await Promise.allSettled([
      listen<Loaded>("chat-document-preview-loaded", ({ payload }) => { if (payload && current?.id === payload.viewId) { current.loaded = true; loaded(); } }),
      listen<Invalidated>("chat-document-preview-invalidated", ({ payload }) => { if (payload && current?.id === payload.viewId) invalidate(`artifact_native_${payload.reason}`); }),
      listen(TauriEvent.WINDOW_BLUR, suspend, { target: { kind: "Window", label: "main" } }),
      listen(TauriEvent.WINDOW_FOCUS, () => { if (opened.value) reload(); }, { target: { kind: "Window", label: "main" } }),
    ]);
    const registered = callbacks.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (disposed) registered.forEach(stop => stop()); else unlisteners = registered;
  } catch { /* Browser-only scaffolds cannot claim Native preview availability. */ }
});
watch(viewport, (value, previous) => { if (previous) resizeObserver?.unobserve(previous); if (value) resizeObserver?.observe(value); });
onBeforeUnmount(() => { disposed = true; epoch++; queued = null; void detach(false); resizeObserver?.disconnect(); mutationObserver?.disconnect(); themeObserver?.disconnect(); unlisteners.forEach(stop => stop()); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", cancelDrag); cancelAnimationFrame(frame); });
return { root, panel, viewport, tabStrip, addButton, separator, opened, state, active, geometry, metadata, phase, error, notice, dragging, capacityText, toggle, openFile, collapse, createTab, selectTab, closeTab, keyTab, navigate, resetWidth, keyResize, startDrag, moveDrag, endDrag, reload };
}
