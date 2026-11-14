import { inject, onBeforeUnmount, provide, shallowRef, watch, type InjectionKey, type ShallowRef } from "vue";
import { ChatArtifactNativeClientError, type ChatArtifactNativeClient } from "../api/chat-artifact-native-client";
import { ChatArtifactVideoNativeClientError, type ChatArtifactVideoNativeClient } from "../api/chat-artifact-video-native-client";
import type { ArtifactProjection } from "../domain/chat-artifact";
import type { ArtifactNativeIdentity } from "../domain/chat-artifact-native";

type Client = ChatArtifactNativeClient | ChatArtifactVideoNativeClient;
type Phase = "idle" | "loading" | "ready" | "error";
type Media = HTMLImageElement | HTMLVideoElement;
export interface ArtifactMediaEntry {
  readonly key: string;
  readonly artifact: ArtifactProjection;
  readonly contextId: string;
  readonly identity: ArtifactNativeIdentity;
  readonly client: Client;
  readonly image: ShallowRef<HTMLImageElement | null>;
  readonly video: ShallowRef<HTMLVideoElement | null>;
  readonly cover: ShallowRef<HTMLCanvasElement | null>;
  readonly phase: ShallowRef<Phase>;
  readonly error: ShallowRef<unknown>;
  owners: number;
  viewers: number;
  used: number;
  decodedBytes: number;
  generation: number;
  disposed: boolean;
  lease: string | null;
  openedAt: number;
  pending: Promise<void> | null;
  cancelDecode: (() => void) | null;
  removeMediaListeners: (() => void) | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
}

// Retain decoded DOM resources, never serialized media bytes or durable URLs.
// Native video permits two handles; covers survive player eviction separately.
const MAX_IDLE_ENTRIES = 24;
const MAX_IDLE_DECODED_BYTES = 96 * 1024 * 1024;
const MAX_VIDEO_HANDLES = 2;
const VIDEO_REUSE_MS = 4 * 60 * 1000; // Below native's five-minute idle lease.
const DECODE_TIMEOUT_MS = 15_000;
const MAX_TIMER_MS = 2_147_483_647;
// A page can unmount while native open/release is still in flight. Its successor
// must wait too, otherwise an old identity-scoped release can revoke a new URL.
let imageQueue = Promise.resolve();
let videoQueue = Promise.resolve();
const releases = new Set<Promise<void>>();

function failure(entry: ArtifactMediaEntry, code: "artifact_native_expired" | "artifact_native_unavailable" | "artifact_native_limit_exceeded") {
  const shape = { schemaVersion: 1 as const, requestId: null, code, retryable: code !== "artifact_native_expired" };
  return entry.artifact.kind === "video" ? new ChatArtifactVideoNativeClientError(shape) : new ChatArtifactNativeClientError(shape);
}
function expired(entry: ArtifactMediaEntry) {
  return entry.artifact.expiresAt !== null && entry.artifact.expiresAt * 1000 <= Date.now();
}
function dimensions(source: Media | HTMLCanvasElement) {
  return source instanceof HTMLVideoElement ? [source.videoWidth, source.videoHeight]
    : source instanceof HTMLImageElement ? [source.naturalWidth, source.naturalHeight] : [source.width, source.height];
}
export function drawArtifactFrame(canvas: HTMLCanvasElement, source: Media | HTMLCanvasElement, maxEdge = Infinity) {
  const [width = 0, height = 0] = dimensions(source);
  if (!width || !height) return false;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return false;
  // Drawing for display is allowed even for an opaque native URL. Do not read
  // pixels, export a data URL, or weaken the native scheme's origin policy.
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return true;
}
function detachVideo(video: HTMLVideoElement | null) {
  if (!video) return;
  try { video.pause(); } catch { /* Native release still revokes a tearing-down WebView. */ }
  video.removeAttribute("src");
  try { video.load(); } catch { /* The element may already be detached during shutdown. */ }
  video.remove();
}

export function createArtifactMediaCache(scope?: { context: () => string | null; allowed: () => boolean }) {
  const entries = new Map<string, ArtifactMediaEntry>();
  let clock = 0;
  let stopped = false;
  const revision = shallowRef(0);
  const canRead = (contextId: string) => !stopped && (!scope || (scope.context() === contextId && scope.allowed()));

  function pauseInactivePlayer(entry: ArtifactMediaEntry, video: HTMLVideoElement) {
    if (entry.disposed || !canRead(entry.contextId) || entry.viewers === 0 || entry.phase.value !== "ready" || entry.video.value !== video) {
      try { video.pause(); } catch { /* Disposal still revokes and clears the native source. */ }
    }
  }

  function releaseNative(entry: ArtifactMediaEntry) {
    if (!entry.lease) return Promise.resolve();
    entry.lease = null;
    const task = Promise.resolve().then(() => entry.artifact.kind === "video"
      ? (entry.client as ChatArtifactVideoNativeClient).releaseVideoPreview(entry.contextId, entry.identity)
      : (entry.client as ChatArtifactNativeClient).releaseImagePreview(entry.contextId, entry.identity)).then(() => {}, () => {});
    releases.add(task);
    void task.finally(() => releases.delete(task));
    return task;
  }
  function dropPlayer(entry: ArtifactMediaEntry) {
    entry.removeMediaListeners?.(); entry.removeMediaListeners = null;
    detachVideo(entry.video.value);
    entry.video.value = null;
    return releaseNative(entry);
  }
  function destroy(entry: ArtifactMediaEntry) {
    if (entry.disposed) return;
    entry.disposed = true;
    entry.generation++;
    entry.cancelDecode?.(); entry.cancelDecode = null;
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.image.value?.removeAttribute("src"); entry.image.value?.remove(); entry.image.value = null;
    entry.cover.value = null;
    void dropPlayer(entry);
    entry.phase.value = "idle";
    entries.delete(entry.key);
  }
  function prune() {
    const idle = [...entries.values()].filter(entry => entry.owners === 0 && entry.viewers === 0).sort((a, b) => a.used - b.used);
    let bytes = idle.reduce((sum, entry) => sum + entry.decodedBytes, 0), count = idle.length;
    for (const entry of idle) {
      if (count <= MAX_IDLE_ENTRIES && bytes <= MAX_IDLE_DECODED_BYTES) break;
      bytes -= entry.decodedBytes; count--; destroy(entry);
    }
  }
  function scheduleExpiry(entry: ArtifactMediaEntry) {
    const at = entry.artifact.expiresAt;
    if (at === null) return;
    const delay = at * 1000 - Date.now();
    entry.expiryTimer = setTimeout(() => {
      if (entry.disposed) return;
      if (!expired(entry)) { scheduleExpiry(entry); return; }
      destroy(entry);
      entry.error.value = failure(entry, "artifact_native_expired");
      entry.phase.value = "error";
    }, Math.max(0, Math.min(delay, MAX_TIMER_MS)));
  }
  function keyFor(artifact: ArtifactProjection, contextId: string) {
    return JSON.stringify([contextId, artifact.sessionId, artifact.turnId, artifact.artifactId, artifact.kind,
      artifact.mediaType, artifact.localCommittedAt, artifact.expiresAt]);
  }
  function sameArtifact(entry: ArtifactMediaEntry, artifact: ArtifactProjection, contextId: string) {
    return entry.contextId === contextId && entry.identity.sessionId === artifact.sessionId
      && entry.identity.turnId === artifact.turnId && entry.identity.artifactId === artifact.artifactId;
  }
  function retain(artifact: ArtifactProjection, contextId: string, client: Client) {
    const key = keyFor(artifact, contextId);
    for (const prior of entries.values()) {
      if (sameArtifact(prior, artifact, contextId) && prior.key !== key) destroy(prior);
    }
    let entry = entries.get(key);
    if (entry && (entry.client !== client || expired(entry))) { destroy(entry); entry = undefined; }
    if (!entry) {
      entry = { key, artifact, contextId, client,
        identity: { sessionId: artifact.sessionId, turnId: artifact.turnId, artifactId: artifact.artifactId },
        image: shallowRef(null), video: shallowRef(null), cover: shallowRef(null), phase: shallowRef("idle"), error: shallowRef(null),
        owners: 0, viewers: 0, used: 0, decodedBytes: 0, generation: 0, disposed: false, lease: null, openedAt: 0,
        pending: null, cancelDecode: null, removeMediaListeners: null, expiryTimer: null };
      entries.set(key, entry);
      scheduleExpiry(entry);
    }
    entry.owners++; entry.used = ++clock;
    return entry;
  }
  function relinquish(entry: ArtifactMediaEntry) {
    entry.owners = Math.max(0, entry.owners - 1);
    entry.used = ++clock;
    if (!entry.owners) entry.video.value?.pause();
    prune();
  }
  function waitForDecode(entry: ArtifactMediaEntry, element: Media, url: string) {
    return new Promise<void>((resolve, reject) => {
      const video = element instanceof HTMLVideoElement;
      const media = video ? element : null;
      const supportsFrameCallback = Boolean(media && typeof media.requestVideoFrameCallback === "function");
      let frameReady = !supportsFrameCallback;
      let frameCallback: number | null = null;
      const cleanup = () => {
        clearTimeout(timer);
        if (frameCallback !== null) media?.cancelVideoFrameCallback(frameCallback);
        frameCallback = null;
        element.removeEventListener("load", loaded);
        element.removeEventListener("loadedmetadata", metadata);
        element.removeEventListener("loadeddata", loaded);
        element.removeEventListener("seeked", loaded);
        element.removeEventListener("error", failed);
        if (entry.cancelDecode === cancel) entry.cancelDecode = null;
      };
      const cancel = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(failure(entry, "artifact_native_unavailable")); };
      const requestFrame = () => {
        if (!media || !supportsFrameCallback || frameCallback !== null) return;
        frameCallback = media.requestVideoFrameCallback(() => {
          frameCallback = null;
          // A seek/load event can precede delivery of the drawable surface in
          // WebKit. Cache only a frame actually presented by the media engine.
          frameReady = true;
          loaded();
        });
      };
      const metadata = () => {
        const media = element as HTMLVideoElement;
        if (Number.isFinite(media.duration) && media.duration > 0) {
          try {
            frameReady = !supportsFrameCallback;
            requestFrame();
            media.currentTime = Math.min(0.1, media.duration / 2);
          }
          catch { /* loadeddata can still provide the initial frame. */ }
        }
      };
      const loaded = () => {
        if (media && (media.seeking || media.readyState < 2 || !frameReady)) return;
        cleanup(); resolve();
      };
      const timer = setTimeout(failed, DECODE_TIMEOUT_MS);
      entry.cancelDecode = cancel;
      element.addEventListener("error", failed);
      if (video) {
        element.addEventListener("loadedmetadata", metadata);
        element.addEventListener("loadeddata", loaded);
        element.addEventListener("seeked", loaded);
      } else element.addEventListener("load", loaded);
      requestFrame();
      element.src = url;
    });
  }

  function prepare(entry: ArtifactMediaEntry, refresh = false): Promise<void> {
    if (entry.disposed || !canRead(entry.contextId)) return Promise.resolve();
    entry.used = ++clock;
    if (entry.pending) return entry.pending;
    if (expired(entry)) {
      destroy(entry); entry.error.value = failure(entry, "artifact_native_expired"); entry.phase.value = "error";
      return Promise.resolve();
    }
    const video = entry.artifact.kind === "video";
    if (!refresh && (video ? entry.video.value && entry.lease && Date.now() - entry.openedAt < VIDEO_REUSE_MS : entry.image.value && entry.phase.value === "ready")) return Promise.resolve();
    const generation = ++entry.generation;
    const current = () => canRead(entry.contextId) && !entry.disposed && generation === entry.generation && !expired(entry);
    const skipAbandoned = () => {
      // Finish already-issued reads and explicit refreshes, but do not make a
      // rapidly visited, now absent task delay the task the user settled on.
      if (refresh || entry.owners > 0 || entry.viewers > 0) return false;
      entry.phase.value = entry.decodedBytes > 0 && (entry.image.value || entry.cover.value) ? "ready" : "idle";
      return true;
    };
    entry.phase.value = "loading"; entry.error.value = null;
    // Refresh may wait behind another decoder. Stop this player immediately,
    // rather than leaving audio running under the pending preview overlay.
    entry.video.value?.pause();
    const task = (video ? videoQueue : imageQueue).then(async () => {
      if (!current() || skipAbandoned()) return;
      await (video ? dropPlayer(entry) : releaseNative(entry));
      await Promise.all([...releases]);
      if (!current() || skipAbandoned()) return;
      try {
        if (video) {
          const candidates = [...entries.values()].filter(other => other !== entry && other.artifact.kind === "video" && other.lease).sort((a, b) => a.used - b.used);
          while (candidates.length >= MAX_VIDEO_HANDLES) {
            const index = candidates.findIndex(other => other.viewers === 0);
            if (index < 0) throw failure(entry, "artifact_native_limit_exceeded");
            await dropPlayer(candidates.splice(index, 1)[0]!);
          }
        }
        if (!current() || skipAbandoned()) return;
        const result = video
          ? await (entry.client as ChatArtifactVideoNativeClient).openVideoPreview(entry.contextId, entry.identity)
          : await (entry.client as ChatArtifactNativeClient).openImagePreview(entry.contextId, entry.identity);
        entry.lease = result.previewUrl; entry.openedAt = Date.now();
        if (!current()) { await releaseNative(entry); return; }
        const element = video ? document.createElement("video") : document.createElement("img");
        if (element instanceof HTMLVideoElement) {
          element.preload = "metadata";
          element.setAttribute("playsinline", "");
          element.setAttribute("controlslist", "nodownload noremoteplayback");
          element.setAttribute("disablepictureinpicture", ""); element.setAttribute("disableremoteplayback", "");
          entry.video.value = element;
          const guard = () => pauseInactivePlayer(entry, element);
          element.addEventListener("play", guard);
          element.addEventListener("playing", guard);
          entry.removeMediaListeners = () => {
            element.removeEventListener("play", guard);
            element.removeEventListener("playing", guard);
          };
        } else if (!entry.image.value) entry.image.value = element;
        await waitForDecode(entry, element, result.previewUrl);
        if (!current()) { if (element instanceof HTMLVideoElement) detachVideo(element); else element.removeAttribute("src"); await releaseNative(entry); return; }
        if (element instanceof HTMLVideoElement) {
          const cover = document.createElement("canvas");
          if (!drawArtifactFrame(cover, element, 880)) throw failure(entry, "artifact_native_unavailable");
          entry.cover.value = cover;
          entry.decodedBytes = cover.width * cover.height * 4;
          const failed = () => {
            if (entry.video.value !== element || entry.disposed) return;
            entry.error.value = failure(entry, "artifact_native_unavailable"); entry.phase.value = "error";
            void dropPlayer(entry);
          };
          element.addEventListener("error", failed);
          const removePlaybackGuard = entry.removeMediaListeners;
          entry.removeMediaListeners = () => { removePlaybackGuard?.(); element.removeEventListener("error", failed); };
        } else {
          const old = entry.image.value;
          entry.image.value = element;
          if (old !== element) { old?.removeAttribute("src"); old?.remove(); }
          entry.decodedBytes = element.naturalWidth * element.naturalHeight * 4;
          // The image URL is one-shot; retain its decoded element, not the URL
          // as a cache entry that a later <img> would attempt to consume again.
          await releaseNative(entry);
        }
        if (!current()) return;
        entry.phase.value = "ready";
        prune();
      } catch (cause) {
        if (!current()) return;
        if (video) await dropPlayer(entry);
        else { await releaseNative(entry); if (!entry.image.value?.complete || !entry.image.value.naturalWidth) entry.image.value = null; }
        if (!current()) return;
        const code = cause instanceof ChatArtifactNativeClientError || cause instanceof ChatArtifactVideoNativeClientError ? cause.shape.code : null;
        if (code && ["artifact_native_expired", "artifact_native_not_found", "artifact_native_forbidden", "artifact_native_unauthenticated", "artifact_native_integrity_failed", "artifact_native_unsupported"].includes(code)) {
          entry.image.value?.removeAttribute("src"); entry.image.value?.remove(); entry.image.value = null;
          entry.cover.value = null; entry.decodedBytes = 0;
        }
        entry.error.value = cause; entry.phase.value = "error";
      }
    });
    entry.pending = task.finally(() => { if (entry.pending === pending) entry.pending = null; });
    const pending = entry.pending;
    if (video) videoQueue = pending; else imageQueue = pending;
    return pending;
  }
  function invalidate(artifact: ArtifactProjection, contextId: string) {
    for (const entry of entries.values()) if (sameArtifact(entry, artifact, contextId)) destroy(entry);
  }
  function clear() { for (const entry of [...entries.values()]) destroy(entry); revision.value++; }
  function dispose() { stopped = true; clear(); }
  return { retain, relinquish, prepare, invalidate, clear, dispose, revision, canRead, pauseInactivePlayer };
}

export type ArtifactMediaCache = ReturnType<typeof createArtifactMediaCache>;
const mediaCacheKey: InjectionKey<ArtifactMediaCache> = Symbol("chat-artifact-media-cache");
export function provideArtifactMediaCache(context: () => string | null, allowed: () => boolean) {
  const cache = createArtifactMediaCache({ context, allowed });
  provide(mediaCacheKey, cache);
  watch([context, allowed], () => cache.clear(), { flush: "sync" });
  onBeforeUnmount(cache.dispose);
  return cache;
}
export function useArtifactMediaCache() {
  const shared = inject(mediaCacheKey, null);
  if (shared) return shared;
  const local = createArtifactMediaCache();
  onBeforeUnmount(local.dispose);
  return local;
}
