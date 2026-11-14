// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { ArtifactProjection } from "../domain/chat-artifact";
import { ChatArtifactVideoNativeClientError, type ChatArtifactVideoNativeClient } from "../api/chat-artifact-video-native-client";
import { ChatArtifactNativeClientError, type ChatArtifactNativeClient } from "../api/chat-artifact-native-client";
import { createArtifactMediaCache, type ArtifactMediaCache } from "./chat-artifact-media-cache";
import { installArtifactMediaDom } from "../../tests/unit/artifact-media-dom";

let dom: ReturnType<typeof installArtifactMediaDom>;
const caches: ArtifactMediaCache[] = [];
const context = "019c1a00-0000-7000-8000-000000000001";
function cache() { const value = createArtifactMediaCache(); caches.push(value); return value; }
function artifact(id = "1", kind: "video" | "image" = "video"): ArtifactProjection {
  return { sessionId: "session", turnId: "turn", artifactId: id, kind, provenance: "synthetic", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: `${id}.${kind === "video" ? "mp4" : "png"}`,
    mediaType: kind === "video" ? "video/mp4" : "image/png", sizeBytes: 4000, localCommittedAt: 1000,
    expiresAt: Math.floor(Date.now() / 1000) + 3600, hasPoster: false, errorCode: null, retryable: null };
}
function videoClient(): ChatArtifactVideoNativeClient {
  let index = 0;
  const live = new Set<string>();
  return {
    openVideoPreview: vi.fn<ChatArtifactVideoNativeClient["openVideoPreview"]>(async (_context, identity) => {
      // Mirror the real native handle budget; exceeding it is a test failure.
      expect(live.size).toBeLessThan(2); expect(live.has(identity.artifactId)).toBe(false);
      live.add(identity.artifactId);
      return { status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${String(++index).padStart(43, "A")}` };
    }),
    releaseVideoPreview: vi.fn<ChatArtifactVideoNativeClient["releaseVideoPreview"]>(async (_context, identity) => { live.delete(identity.artifactId); return { status: "released" }; }),
    saveVideo: vi.fn<ChatArtifactVideoNativeClient["saveVideo"]>(async () => ({ status: "saved", code: null })),
  };
}
function imageClient(): ChatArtifactNativeClient {
  let index = 0;
  return { openImagePreview: vi.fn<ChatArtifactNativeClient["openImagePreview"]>(async () => ({ status: "opened", previewUrl: `yijie-artifact-preview://localhost/v1/${String(++index).padStart(43, "A")}` })),
    releaseImagePreview: vi.fn<ChatArtifactNativeClient["releaseImagePreview"]>(async () => ({ status: "released" })), copyImage: vi.fn<ChatArtifactNativeClient["copyImage"]>(async () => ({ status: "copied" })),
    saveImage: vi.fn<ChatArtifactNativeClient["saveImage"]>(async () => ({ status: "saved", code: null })) };
}
beforeEach(() => { dom = installArtifactMediaDom(); });
afterEach(async () => { caches.splice(0).forEach(cache => cache.dispose()); await flushPromises(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("artifact decoded media cache", () => {
  it.each(["before", "after"])("waits for a drawable video frame when presentation arrives %s seek completion", async order => {
    let presented!: VideoFrameRequestCallback;
    const callbacks = vi.fn((callback: VideoFrameRequestCallback) => { presented = callback; return 1; });
    const requestDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "requestVideoFrameCallback");
    const cancelDescriptor = Object.getOwnPropertyDescriptor(HTMLVideoElement.prototype, "cancelVideoFrameCallback");
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { configurable: true, value: callbacks });
    Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", { configurable: true, value: vi.fn() });
    try {
      const pool = cache(), entry = pool.retain(artifact(), context, videoClient());
      const pending = pool.prepare(entry);
      await flushPromises();
      const video = dom.videos[0]!;
      let seeking = true;
      Object.defineProperty(video, "seeking", { configurable: true, get: () => seeking });
      video.dispatchEvent(new Event("loadedmetadata"));
      video.dispatchEvent(new Event("loadeddata"));
      if (order === "before") presented(0, { mediaTime: 0.1 } as VideoFrameCallbackMetadata);
      expect(entry.phase.value).toBe("loading");
      expect(entry.cover.value).toBeNull();
      seeking = false;
      video.dispatchEvent(new Event("seeked"));
      if (order === "after") {
        await flushPromises();
        expect(entry.cover.value).toBeNull();
        presented(0, { mediaTime: 0.1 } as VideoFrameCallbackMetadata);
      }
      await pending;
      expect(entry.phase.value).toBe("ready");
      expect(entry.cover.value).not.toBeNull();
    } finally {
      delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback;
      delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback;
      if (requestDescriptor) Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", requestDescriptor);
      if (cancelDescriptor) Object.defineProperty(HTMLVideoElement.prototype, "cancelVideoFrameCallback", cancelDescriptor);
    }
  });
  it("isolates the full task identity when artifact identifiers and display names coincide", async () => {
    const pool = cache(), client = imageClient(), a = artifact("shared-id", "image");
    const first = pool.retain(a, context, client), firstRead = pool.prepare(first); await dom.decodeAll(); await firstRead;
    pool.relinquish(first);
    const b = { ...a, sessionId: "another-session" };
    const second = pool.retain(b, context, client), secondRead = pool.prepare(second); await dom.decodeAll(); await secondRead;
    expect(first.disposed).toBe(false); expect(first.image.value).not.toBe(second.image.value);
    pool.invalidate(b, context);
    expect(first.disposed).toBe(false);
    expect(pool.retain(a, context, client)).toBe(first);
    expect(client.openImagePreview).toHaveBeenCalledTimes(2);
  });
  it("skips abandoned queued previews after the already-issued read completes", async () => {
    const pool = cache(), client = videoClient();
    let resolve!: (value: { status: "opened"; previewUrl: string }) => void;
    vi.mocked(client.openVideoPreview).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = pool.retain(artifact("a"), context, client), pending = [pool.prepare(first)];
    await flushPromises(); pool.relinquish(first);
    for (const id of ["b", "c", "d"]) {
      const skipped = pool.retain(artifact(id), context, client);
      pending.push(pool.prepare(skipped)); pool.relinquish(skipped);
    }
    const last = pool.retain(artifact("e"), context, client);
    pending.push(pool.prepare(last));
    resolve({ status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${"A".repeat(43)}` });
    await dom.decodeAll(); await Promise.all(pending);
    expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
    expect(last.phase.value).toBe("ready"); expect(first.cover.value).not.toBeNull();
  });
  it("reuses the decoded image, including across release and retain of its component owner", async () => {
    const pool = cache(), client = imageClient(), data = artifact("1", "image");
    const first = pool.retain(data, context, client);
    const loading = pool.prepare(first); await dom.decodeAll(); await loading;
    const image = first.image.value;
    expect(first.phase.value).toBe("ready");
    expect(client.releaseImagePreview).toHaveBeenCalledOnce();
    pool.relinquish(first);
    const next = pool.retain({ ...data, displayName: "新名称.png", sizeBytes: 5000 }, context, client);
    await pool.prepare(next);
    expect(next).toBe(first); expect(next.image.value).toBe(image);
    expect(client.openImagePreview).toHaveBeenCalledOnce();
    expect(image?.getAttribute("src")).toBeTruthy();
  });

  it("keeps covers while respecting the two-video native limit across several conversations", async () => {
    const pool = cache(), client = videoClient(), data = artifact("1");
    const entries = [];
    for (let id = 1; id <= 4; id++) {
      const entry = pool.retain({ ...data, artifactId: String(id), sessionId: `session-${id}` }, context, client);
      const loading = pool.prepare(entry); await dom.decodeAll(); await loading;
      entries.push(entry); pool.relinquish(entry);
    }
    expect(entries.every(entry => entry.cover.value !== null)).toBe(true);
    expect(entries.filter(entry => entry.video.value)).toHaveLength(2);
    expect(client.openVideoPreview).toHaveBeenCalledTimes(4);
    expect(client.releaseVideoPreview).toHaveBeenCalledTimes(2);
    const first = pool.retain(entries[0]!.artifact, context, client), cover = first.cover.value;
    expect(first).toBe(entries[0]); expect(first.phase.value).toBe("ready");
    expect(client.openVideoPreview).toHaveBeenCalledTimes(4);
    const opening = pool.prepare(first);
    expect(first.cover.value).toBe(cover);
    await dom.decodeAll(); await opening;
    expect(first.video.value).not.toBeNull();
    expect(client.openVideoPreview).toHaveBeenCalledTimes(5);
    expect(client.releaseVideoPreview).toHaveBeenCalledTimes(3);
  });

  it("refreshes explicitly, replaces the frame atomically and detaches before releasing", async () => {
    const pool = cache(), client = videoClient(), entry = pool.retain(artifact(), context, client);
    const loading = pool.prepare(entry); await dom.decodeAll(); await loading;
    const previous = entry.video.value!, cover = entry.cover.value;
    previous.currentTime = 4;
    await pool.prepare(entry);
    expect(entry.video.value).toBe(previous); expect(previous.currentTime).toBe(4);
    const order: string[] = [];
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => { order.push("pause"); });
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(() => { order.push("load"); });
    const release = client.releaseVideoPreview;
    vi.mocked(client.releaseVideoPreview).mockImplementationOnce(async () => { order.push("release"); return { status: "released" }; });
    // Use a client without the budget mirror for this ordering check.
    vi.mocked(client.openVideoPreview).mockResolvedValueOnce({ status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${"B".repeat(43)}` });
    const refresh = pool.prepare(entry, true); expect(entry.cover.value).toBe(cover);
    await dom.decodeAll(); await refresh;
    expect(order.indexOf("pause")).toBeLessThan(order.indexOf("load"));
    expect(order.indexOf("load")).toBeLessThan(order.indexOf("release"));
    expect(previous.getAttribute("src")).toBeNull();
    expect(entry.video.value).not.toBe(previous); expect(entry.cover.value).not.toBe(cover);
    expect(release).toHaveBeenCalledOnce();
  });

  it("serializes image reads and deduplicates concurrent preparation", async () => {
    const pool = cache(), client = imageClient();
    const a = pool.retain(artifact("a", "image"), context, client), b = pool.retain(artifact("b", "image"), context, client);
    const one = pool.prepare(a), duplicate = pool.prepare(a), two = pool.prepare(b);
    expect(one).toBe(duplicate);
    await flushPromises(); expect(client.openImagePreview).toHaveBeenCalledOnce();
    await dom.decodeAll(); await Promise.all([one, two]);
    expect(client.openImagePreview).toHaveBeenCalledTimes(2);
    expect(a.phase.value).toBe("ready"); expect(b.phase.value).toBe("ready");
  });
  it("pauses refresh immediately even while another video decoder holds the queue", async () => {
    const pool = cache(), client = videoClient(), a = pool.retain(artifact("a"), context, client);
    const initial = pool.prepare(a); await dom.decodeAll(); await initial;
    a.viewers = 1;
    const player = a.video.value!; await player.play(); expect(player.paused).toBe(false);
    const b = pool.retain(artifact("b"), context, client), other = pool.prepare(b);
    await flushPromises();
    const refreshing = pool.prepare(a, true);
    expect(player.paused).toBe(true);
    dom.startPlayback(player); expect(player.paused).toBe(true);
    await dom.decodeAll(); await Promise.all([other, refreshing]);
    expect(a.phase.value).toBe("ready"); expect(a.video.value!.paused).toBe(true);
  });

  it("clears decoded content on authority invalidation and releases a late open before the next one", async () => {
    const pool = cache(), client = videoClient();
    let resolve!: (value: { status: "opened"; previewUrl: string }) => void;
    vi.mocked(client.openVideoPreview).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const first = pool.retain(artifact(), context, client), pending = pool.prepare(first);
    await flushPromises(); pool.clear();
    const second = pool.retain(artifact(), "new-context", client), next = pool.prepare(second);
    resolve({ status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${"A".repeat(43)}` });
    await dom.decodeAll(); await Promise.all([pending, next]);
    expect(first.cover.value).toBeNull(); expect(first.video.value).toBeNull();
    expect(client.releaseVideoPreview).toHaveBeenCalledWith(context, first.identity);
    expect(vi.mocked(client.releaseVideoPreview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.openVideoPreview).mock.invocationCallOrder[1]!);
    expect(second.phase.value).toBe("ready");
  });

  it("invalidates a replaced content version even when the artifact ID stays the same", async () => {
    const pool = cache(), client = videoClient(), data = artifact();
    const first = pool.retain(data, context, client), a = pool.prepare(first); await dom.decodeAll(); await a;
    const second = pool.retain({ ...data, localCommittedAt: 2000 }, context, client), b = pool.prepare(second);
    await dom.decodeAll(); await b;
    expect(first.disposed).toBe(true); expect(first.cover.value).toBeNull();
    expect(second).not.toBe(first); expect(second.phase.value).toBe("ready");
  });
  it("serializes a disposed page's late open before its successor page opens the same video", async () => {
    const previous = cache(), client = videoClient();
    let resolve!: (value: { status: "opened"; previewUrl: string }) => void;
    vi.mocked(client.openVideoPreview).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const old = previous.prepare(previous.retain(artifact(), context, client)); await flushPromises();
    previous.dispose();
    const next = cache(), entry = next.retain(artifact(), context, client), opening = next.prepare(entry);
    await flushPromises(); expect(client.openVideoPreview).toHaveBeenCalledOnce();
    resolve({ status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${"A".repeat(43)}` });
    await dom.decodeAll(); await Promise.all([old, opening]);
    expect(entry.phase.value).toBe("ready"); expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
    expect(vi.mocked(client.releaseVideoPreview).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.openVideoPreview).mock.invocationCallOrder[1]!);
  });

  it("bounds idle decoded memory and evicts the least recently used images", async () => {
    const pool = cache(), client = imageClient();
    vi.mocked(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalWidth")!.get!).mockReturnValue(4096);
    vi.mocked(Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "naturalHeight")!.get!).mockReturnValue(4096);
    const first = pool.retain(artifact("1", "image"), context, client), a = pool.prepare(first); await dom.decodeAll(); await a; pool.relinquish(first);
    const second = pool.retain(artifact("2", "image"), context, client), b = pool.prepare(second); await dom.decodeAll(); await b; pool.relinquish(second);
    expect(first.disposed).toBe(true); expect(first.image.value).toBeNull();
    expect(second.image.value).not.toBeNull();
  });

  it("refreshes an expired native player lease without discarding its cover first", async () => {
    const pool = cache(), client = videoClient(), entry = pool.retain(artifact(), context, client);
    const first = pool.prepare(entry); await dom.decodeAll(); await first;
    const cover = entry.cover.value;
    entry.openedAt = Date.now() - 5 * 60 * 1000;
    const reopen = pool.prepare(entry); expect(entry.cover.value).toBe(cover);
    await dom.decodeAll(); await reopen;
    expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
    expect(entry.phase.value).toBe("ready");
  });

  it("removes retained pixels when the artifact expires", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const pool = cache(), client = imageClient(), data = { ...artifact("1", "image"), expiresAt: Math.floor(Date.now() / 1000) + 2 };
    const entry = pool.retain(data, context, client), ready = pool.prepare(entry); await dom.decodeAll(); await ready;
    await vi.advanceTimersByTimeAsync(2000);
    expect(entry.image.value).toBeNull(); expect(entry.phase.value).toBe("error"); expect(entry.disposed).toBe(true);
  });
  it.each(["image", "video"] as const)("drops retained %s pixels on a definitive native permission denial", async kind => {
    const pool = cache(), client = kind === "image" ? imageClient() : videoClient();
    const entry = pool.retain(artifact("1", kind), context, client), first = pool.prepare(entry);
    await dom.decodeAll(); await first;
    const shape = { schemaVersion: 1 as const, requestId: null, code: "artifact_native_forbidden" as const, retryable: false };
    if ("openImagePreview" in client) vi.mocked(client.openImagePreview).mockRejectedValueOnce(new ChatArtifactNativeClientError(shape));
    else vi.mocked(client.openVideoPreview).mockRejectedValueOnce(new ChatArtifactVideoNativeClientError(shape));
    await pool.prepare(entry, true);
    expect(entry.phase.value).toBe("error"); expect(entry.image.value).toBeNull(); expect(entry.cover.value).toBeNull();
  });
  it("releases a stalled decoder after its bounded wait and permits an ordinary retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const pool = cache(), client = videoClient(), entry = pool.retain(artifact(), context, client);
    const first = pool.prepare(entry); await flushPromises();
    await vi.advanceTimersByTimeAsync(15_000); await first;
    expect(entry.phase.value).toBe("error"); expect(entry.video.value).toBeNull(); expect(client.releaseVideoPreview).toHaveBeenCalledOnce();
    const retry = pool.prepare(entry); await dom.decodeAll(); await retry;
    expect(entry.phase.value).toBe("ready");
  });
});
