import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, useTemplateRef } from "vue";
import { listen, TauriEvent, type UnlistenFn } from "@tauri-apps/api/event";
import { documentPreviewClient, DocumentPreviewError } from "../api/chat-document-preview-client";
import type { Document as PreviewDocument, Invalidated, Loaded, Viewport } from "../domain/document-preview.generated";
import { addPreviewTab, closePreviewTab, defaultPreviewLocation, isSidebarFile, openPreviewFile, previewFailure, previewWidths, type PreviewFile, type PreviewTab, type PreviewTabs } from "../domain/conversation-file-preview";
import { useWorkspaceFullscreen } from "./useWorkspaceFullscreen";

export function useConversationDocumentPreview(props: Readonly<{ contextId: string | null; scopeKey: string; enabled: boolean }>, emit: { (event: "expanded", value: boolean): void; (event: "restoreTrigger"): void }) {
const root = useTemplateRef<HTMLElement>("root");
const panel = useTemplateRef<HTMLElement>("panel");
const viewport = useTemplateRef<HTMLElement>("viewport");
const tabStrip = useTemplateRef<HTMLElement>("tabStrip");
const addButton = useTemplateRef<HTMLButtonElement>("addButton");
const fullscreenButton = useTemplateRef<HTMLButtonElement>("fullscreenButton");
const separator = useTemplateRef<HTMLElement>("separator");
const opened = ref(false);
// Local media uses the same isolated reader in a dialog, without creating or
// selecting a document tab. Closing it resumes the previous document.
const media = ref<PreviewTab | null>(null);
const mediaViewport = useTemplateRef<HTMLElement>("mediaViewport");
const activeViewport = computed(() => media.value ? mediaViewport.value : viewport.value);
const presenting = computed(() => Boolean(media.value || opened.value));
const { fullscreen, fullscreenTarget } = useWorkspaceFullscreen();
const width = ref(0);
const preferred = ref<number | null>(null);
const state = reactive<PreviewTabs>({ tabs: [], activeId: null });
const active = computed(() => state.tabs.find(t => t.id === state.activeId) ?? null);
const geometry = computed(() => previewWidths(width.value, preferred.value));
const metadata = ref<PreviewDocument | null>(null);
const phase = ref<"empty" | "loading" | "ready" | "error" | "paused" | "artifact">("empty");
const error = ref<ReturnType<typeof previewFailure> | null>(null);
const notice = ref("");
const dragging = ref(false);
let drag: { start: number; width: number; preference: number | null; pointerId: number; scale: number } | null = null;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let themeObserver: MutationObserver | undefined;
let unlisteners: UnlistenFn[] = [];
let disposed = false;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let frame: number | null = null;
let inFlight = false;
let queued: { tab: PreviewTab; epoch: number; context: string } | null = null;
type NativeView = { id: string; context: string; tab: PreviewTab; loaded: boolean; bounds: Viewport; visible: boolean; resize?: Promise<void> };
let current: NativeView | null = null;
const closeTasks = new Set<Promise<void>>();
const newId = () => crypto.randomUUID();
const capacityText = "最多打开10个标签页，请先关闭一个";
const insufficientSpaceText = "窗口空间不足，请扩大窗口后打开文件预览";

function measuredViewport(): Viewport | null {
  const r = activeViewport.value?.getBoundingClientRect();
  return r && r.width >= 1 && r.height >= 1 ? { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 } : null;
}
function blockingOverlayVisible(): boolean {
  const bounds = activeViewport.value?.getBoundingClientRect();
  if (!bounds) return false;
  return [...document.querySelectorAll<HTMLElement>('.n-modal-container,.n-dropdown-menu,.n-popover,[aria-modal="true"],dialog[open]')].some(e => {
    if (media.value && mediaViewport.value && e.contains(mediaViewport.value)) return false;
    if (e.matches('.n-tooltip,[role="tooltip"]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
      && r.left < bounds.right && r.right > bounds.left && r.top < bounds.bottom && r.bottom > bounds.top;
  });
}
function syncViewport() {
  if (disposed || frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const view = current;
    if (!view || disposed) return;
    if (view.resize) {
      void view.resize.then(syncViewport);
      return;
    }
    const bounds = measuredViewport();
    if (!bounds) return;
    const visible = presenting.value && phase.value === "ready" && document.visibilityState !== "hidden" && !blockingOverlayVisible();
    const last = view.bounds;
    if (visible === view.visible && bounds.x === last.x && bounds.y === last.y &&
        bounds.width === last.width && bounds.height === last.height && bounds.dpr === last.dpr) return;
    // Apply frame and visibility changes in order. A late resize must not cover
    // an open menu or blank a document that has already become visible again.
    view.resize = documentPreviewClient.run(view.context, { action: "resize", viewId: view.id, viewport: bounds, visible })
      .then(() => { view.bounds = bounds; view.visible = visible; })
      .catch(() => { /* A later layout change retries while this view is live. */ })
      .finally(() => { view.resize = undefined; });
  });
}
function detach(preserve: boolean): Promise<void> {
  const view = current; current = null;
  metadata.value = null;
  clearTimeout(timer); clearTimeout(deadline);
  if (!view) return Promise.resolve();
  const task = (async () => {
    await view.resize;
    await documentPreviewClient.run(view.context, { action: "resize", viewId: view.id, viewport: view.bounds, visible: false }).catch(() => {});
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
  if (!current?.loaded || !metadata.value || !presenting.value || phase.value === "error") return;
  clearTimeout(timer); phase.value = "ready"; syncViewport();
}
async function pump() {
  if (inFlight || disposed || !queued) return;
  inFlight = true;
  const job = queued; queued = null;
  const viewId = newId();
  try {
    await Promise.all([...closeTasks]); await nextTick();
    if (job.epoch !== epoch || !presenting.value || !job.tab.file) return;
    const bounds = measuredViewport(); if (!bounds) throw new DocumentPreviewError("artifact_native_unavailable");
    const view: NativeView = { id: viewId, context: job.context, tab: job.tab, loaded: false, bounds, visible: false }; current = view;
    const result = await documentPreviewClient.run(job.context, { action: "open", viewId, source: job.tab.file.source, viewport: bounds, location: job.tab.location, theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light" });
    if (job.epoch !== epoch || disposed || current !== view || !presenting.value) {
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
  const tab = media.value ?? active.value;
  if (!presenting.value || !props.enabled || !props.contextId || !tab?.file) { phase.value = "empty"; return; }
  if (tab.file.status === "expired" || (tab.file.expiresAt !== null && tab.file.expiresAt <= Date.now() / 1000)) { invalidate("artifact_native_expired"); return; }
  if (tab.file.artifact?.kind === "report") {
    // Structured reports use their existing scoped report reader.
    // Mount only the active one, after releasing any previous document view.
    phase.value = "loading";
    void closed.then(() => {
      if (generation !== epoch) return;
      phase.value = "artifact";
      if (tab.file?.expiresAt) deadline = setTimeout(() => invalidate("artifact_native_expired"), Math.max(0, tab.file.expiresAt * 1000 - Date.now()));
    });
    return;
  }
  phase.value = "loading";
  queued = { tab, epoch: generation, context: props.contextId };
  // Office cold verification plus its existing 180 s conversion soft deadline.
  // Closing the view still revokes visibility immediately and preserves Native
  // work ownership until the conversion exits normally.
  const office = /\.(docx|pptx|xlsx)$/iu.test(tab.file.name) || tab.file.mediaType.startsWith("application/vnd.openxmlformats-officedocument.");
  timer = setTimeout(() => { if (generation === epoch) invalidate("preview_timeout"); }, office ? 200000 : 15000);
  void closed.then(() => { if (generation === epoch) void pump(); });
}
function focusTab(id: string | null) {
  void nextTick(() => {
    const element = id ? tabStrip.value?.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`) : addButton.value;
    element?.focus({ preventScroll: true });
    (element?.closest<HTMLElement>("[data-preview-tab]") ?? element)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  });
}
function ensureOpen(): boolean {
  if (!props.enabled) return false;
  if (!fullscreen.value && !geometry.value.available) { notice.value = insufficientSpaceText; return false; }
  if (!state.tabs.length) addPreviewTab(state, newId);
  notice.value = ""; opened.value = true; return true;
}
function openFile(file: PreviewFile) {
  if (!props.enabled) return;
  if (!isSidebarFile(file.mediaType, file.name) || file.artifact?.kind === "image" || file.artifact?.kind === "video") {
    if (file.source.kind === "messageFile") {
      media.value = {id: newId(), file, location: defaultPreviewLocation()};
      reload();
    }
    return;
  }
  if (!ensureOpen()) return;
  const previous = active.value; const previousSource = previous?.file?.source; const wasReady = phase.value === "ready" || phase.value === "loading";
  const tab = openPreviewFile(state, file, newId);
  if (!tab) { notice.value = capacityText; return; }
  const retargeted = previousSource?.kind === "messageFile" && file.source.kind === "messageFile" &&
    (previousSource.turnId !== file.source.turnId || previousSource.itemId !== file.source.itemId || previousSource.reference !== file.source.reference);
  if (tab !== previous || retargeted || (phase.value !== "artifact" && (!wasReady || !current))) reload();
  focusTab(tab.id);
}
function closeMedia() {
  media.value = null;
  measureLayout();
  reload(false);
}
function collapse(restore = true) {
  fullscreen.value = false; opened.value = false; epoch++; queued = null; phase.value = "empty"; endDrag(false); void detach(true);
  if (restore) emit("restoreTrigger");
}
function toggle() {
  if (opened.value) collapse(); else if (ensureOpen()) { reload(); if (active.value) focusTab(active.value.id); else void nextTick(() => addButton.value?.focus()); }
}
function toggleFullscreen() {
  if (!opened.value) return;
  endDrag(false);
  fullscreen.value = !fullscreen.value;
  void nextTick(() => {
    measureLayout(undefined, !fullscreen.value);
    if (opened.value) fullscreenButton.value?.focus({ preventScroll: true });
    syncViewport();
  });
}
function fullscreenKey(event: KeyboardEvent) {
  if (fullscreen.value && event.key === "Escape" && !event.defaultPrevented && !blockingOverlayVisible()) {
    event.preventDefault(); toggleFullscreen();
  }
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
  closePreviewTab(state, id);
  notice.value = "";
  if (!state.tabs.length) { collapse(); return; }
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
function navigate(section: number, offset: number) {
  if (!active.value) return;
  active.value.location = { ...active.value.location, section, offset, scrollX: 0, scrollY: 0 };
  reload(false);
}
function selectViewMode(mode: "layout" | "content") {
  if (!active.value || !metadata.value?.availableModes?.includes(mode)) return;
  active.value.location = { ...active.value.location, viewMode: mode, section: 0, offset: 0, scrollX: 0, scrollY: 0 };
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
  event.preventDefault(); separator.value?.focus({ preventScroll: true });
  const scale = (root.value?.getBoundingClientRect().width ?? 0) / width.value;
  drag = { start: event.clientX, width: geometry.value.right, preference: preferred.value, pointerId: event.pointerId, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
  dragging.value = true; separator.value?.setPointerCapture?.(event.pointerId); syncViewport();
}
function moveDrag(event: PointerEvent) { if (drag) preferred.value = Math.max(geometry.value.min, Math.min(geometry.value.max, drag.width + (drag.start - event.clientX) / drag.scale)); }
function endDrag(commit = true) {
  const previous = drag; drag = null; dragging.value = false;
  if (previous) { if (!commit) preferred.value = previous.preference; if (separator.value?.hasPointerCapture?.(previous.pointerId)) separator.value.releasePointerCapture(previous.pointerId); }
  syncViewport();
}
function cancelDrag() { if (drag) endDrag(false); }
function measureLayout(measured?: number, restoreOnCollapse = false) {
  // Grid columns and panel minimums use unzoomed layout pixels. Native child
  // positioning above deliberately keeps visual getBoundingClientRect values.
  const element = root.value;
  const cssWidth = element ? getComputedStyle(element).width : "";
  const fallback = cssWidth.endsWith("px") ? Number.parseFloat(cssWidth) : element?.clientWidth ?? 0;
  const next = measured ?? fallback;
  if (next !== width.value && drag) endDrag(false);
  width.value = next;
  if (!geometry.value.available && opened.value && !fullscreen.value && !media.value) {
    const focusHidden = restoreOnCollapse || panel.value?.contains(document.activeElement) || separator.value === document.activeElement;
    collapse(Boolean(focusHidden)); notice.value = insufficientSpaceText;
  }
  if (geometry.value.available && notice.value === insufficientSpaceText) notice.value = "";
}
function suspend() {
  cancelDrag(); epoch++; queued = null; void detach(true);
  phase.value = media.value || active.value?.file ? "paused" : "empty";
}
function visibility() {
  cancelDrag();
  if (document.visibilityState === "hidden") suspend();
  else if (presenting.value && phase.value === "paused") reload();
}
watch(opened, value => emit("expanded", value), { immediate: true });
watch(() => geometry.value.right, () => { void nextTick(syncViewport); });
// Scope follows route + authenticated tenant/revision/capability. A short-lived
// Native context can renew within that same scope; release its content at once,
// then authorize/read again using the replacement context without losing tabs.
watch(() => props.scopeKey, () => { media.value = null; collapse(false); state.tabs = []; state.activeId = null; preferred.value = null; notice.value = ""; });
watch(() => [props.contextId, props.enabled], () => {
  if (!props.contextId || !props.enabled) suspend();
  else if (presenting.value) reload();
});
onMounted(async () => {
  resizeObserver = new ResizeObserver(entries => {
    const resizedRoot = entries.find(e => e.target === root.value);
    if (resizedRoot) measureLayout(resizedRoot.contentRect?.width);
    syncViewport();
  });
  if (root.value) { measureLayout(); resizeObserver.observe(root.value); }
  mutationObserver = new MutationObserver(syncViewport); mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "aria-modal", "hidden", "open"] });
  themeObserver = new MutationObserver(records => {
    if (records.some(record => record.attributeName === "data-ui-zoom-percent")) { cancelDrag(); measureLayout(); syncViewport(); }
    if (records.some(record => record.attributeName === "data-theme") && presenting.value) reload();
  });
  themeObserver.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme", "data-ui-zoom-percent"] });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", cancelDrag);
  window.addEventListener("keydown", fullscreenKey);
  try {
    const callbacks = await Promise.allSettled([
      listen<Loaded>("chat-document-preview-loaded", ({ payload }) => { if (payload && current?.id === payload.viewId) { current.loaded = true; loaded(); } }),
      listen<Invalidated>("chat-document-preview-invalidated", ({ payload }) => { if (payload && current?.id === payload.viewId) invalidate(`artifact_native_${payload.reason}`); }),
      listen(TauriEvent.WINDOW_BLUR, suspend, { target: { kind: "Window", label: "main" } }),
      listen(TauriEvent.WINDOW_FOCUS, () => { if (presenting.value && phase.value === "paused") reload(); }, { target: { kind: "Window", label: "main" } }),
    ]);
    const registered = callbacks.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
    if (disposed) registered.forEach(stop => stop()); else unlisteners = registered;
  } catch { /* Browser-only scaffolds cannot claim Native preview availability. */ }
});
watch(activeViewport, (value, previous) => { if (previous) resizeObserver?.unobserve(previous); if (value) resizeObserver?.observe(value); });
onBeforeUnmount(() => { disposed = true; epoch++; queued = null; void detach(false); resizeObserver?.disconnect(); mutationObserver?.disconnect(); themeObserver?.disconnect(); unlisteners.forEach(stop => stop()); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", cancelDrag); window.removeEventListener("keydown", fullscreenKey); if (frame !== null) cancelAnimationFrame(frame); });
return { root, panel, viewport, media, mediaViewport, closeMedia, syncViewport, tabStrip, addButton, separator, opened, fullscreen, fullscreenTarget, state, active, geometry, metadata, phase, error, notice, dragging, capacityText, toggle, toggleFullscreen, openFile, collapse, createTab, selectTab, closeTab, keyTab, navigate, selectViewMode, resetWidth, keyResize, startDrag, moveDrag, endDrag, reload };
}
