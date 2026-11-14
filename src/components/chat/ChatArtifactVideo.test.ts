// @vitest-environment happy-dom
import axe from "axe-core";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { NModal } from "naive-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatArtifactVideoNativeClientError, type ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import { installArtifactMediaDom } from "../../../tests/unit/artifact-media-dom";
import ChatArtifactVideo from "./ChatArtifactVideo.vue";
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("naive-ui", async original => ({ ...await original<typeof import("naive-ui")>(), useMessage: () => toast }));
const CONTEXT = "019c1a00-0000-7000-8000-000000000501", NEXT_CONTEXT = "019c1a00-0000-7000-8000-000000000502";
const IDENTITY = { sessionId: "019c1a00-0000-7000-8000-000000000503", turnId: "019c1a00-0000-7000-8000-000000000504", artifactId: "019c1a00-0000-7000-8000-000000000505" };
const URLS = ["A", "B", "C", "D"].map(letter => `yijie-artifact-video://localhost/v1/${letter.repeat(43)}`);
let mediaDom: ReturnType<typeof installArtifactMediaDom>;
function artifact(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(IDENTITY.sessionId, IDENTITY.turnId, { artifactId: IDENTITY.artifactId, kind: "video", provenance: "provider", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: "商品展示.mp4", mediaType: "video/mp4", sizeBytes: 9_122_611,
    localCommittedAt: 1_000, expiresAt: Math.floor(Date.now() / 1000) + 3600, hasPoster: false, errorCode: null, retryable: null, ...overrides });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function nativeClient(): ChatArtifactVideoNativeClient {
  let index = 0;
  return { openVideoPreview: vi.fn<ChatArtifactVideoNativeClient["openVideoPreview"]>(async () => ({ status: "opened", previewUrl: URLS[index++]! })),
    releaseVideoPreview: vi.fn<ChatArtifactVideoNativeClient["releaseVideoPreview"]>(async () => ({ status: "released" })), saveVideo: vi.fn<ChatArtifactVideoNativeClient["saveVideo"]>(async () => ({ status: "saved", code: null })) };
}
async function mounted(client = nativeClient(), decode = true) {
  const view = mount(ChatArtifactVideo, { attachTo: document.body, props: { artifact: artifact(), contextId: CONTEXT, client }, global: { stubs: { transition: false } } });
  await flushPromises(); if (decode) await mediaDom.decodeAll(); return view;
}
function dialog() { return new DOMWrapper(document.querySelector<HTMLElement>("[data-testid='artifact-video-dialog']")!); }
async function open(view: Awaited<ReturnType<typeof mounted>>) {
  await view.get("[data-testid='artifact-video-preview']").trigger("click"); await flushPromises(); return dialog();
}
enableAutoUnmount(afterEach);
beforeEach(() => { toast.success.mockClear(); toast.error.mockClear(); mediaDom = installArtifactMediaDom(); });
afterEach(async () => { await flushPromises(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("ChatArtifactVideo", () => {
  it("decodes a real still cover once without an inline player, autoplay or metadata clutter", async () => {
    const client = nativeClient(), view = await mounted(client);
    expect(view.get("canvas").attributes("aria-hidden")).toBe("true");
    expect(view.find("video").exists()).toBe(false);
    expect(view.text()).toBe("");
    expect(view.get("button").attributes("aria-busy")).toBe("false");
    expect(mediaDom.videos[0]!.currentTime).toBe(0.1);
    expect(client.openVideoPreview).toHaveBeenCalledExactlyOnceWith(CONTEXT, IDENTITY);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
  it("reuses the prepared video and presents filename, metadata, refresh then download", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    expect(modal.get("header strong").text()).toBe("商品展示.mp4");
    expect(modal.get(".artifact-video__metadata").text()).toBe("MP4 · 8.7 MB");
    expect(modal.findAll("header button").map(button => button.attributes("aria-label"))).toEqual(["关闭视频预览", "刷新预览", "下载视频"]);
    const player = modal.get("video");
    expect(player.element).toBe(mediaDom.videos[0]);
    expect(player.attributes("src")).toBe(URLS[0]);
    expect(player.attributes("controlslist")).toBe("nodownload noremoteplayback");
    for (const attribute of ["controls", "playsinline", "disablepictureinpicture", "disableremoteplayback"]) expect(player.attributes(attribute)).toBeDefined();
    expect(player.attributes("autoplay")).toBeUndefined();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(client.openVideoPreview).toHaveBeenCalledOnce();
    expect(client.releaseVideoPreview).not.toHaveBeenCalled();
    expect(view.findComponent(NModal).props()).toMatchObject({ trapFocus: true, closeOnEsc: true });
  });
  it("pauses on close, preserves the cover and playback position, and reopens without a read", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    const cover = view.get("canvas").element, player = modal.get<HTMLVideoElement>("video").element;
    player.currentTime = 4;
    expect(player.paused).toBe(false);
    await modal.trigger("keydown", { key: "Escape" }); await flushPromises();
    expect(view.findComponent(NModal).props("show")).toBe(false);
    expect(player.paused).toBe(true);
    expect(view.get("canvas").element).toBe(cover); expect(player.getAttribute("src")).toBe(URLS[0]);
    expect(document.activeElement).toBe(view.get("button").element);
    await open(view);
    expect(dialog().get("video").element).toBe(player); expect(player.currentTime).toBe(4);
    expect(client.openVideoPreview).toHaveBeenCalledOnce(); expect(client.releaseVideoPreview).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });
  it("keeps a closed video paused when its already-issued play finishes late", async () => {
    const pending = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      return pending.promise.then(() => mediaDom.startPlayback(this));
    });
    const view = await mounted(), modal = await open(view), player = modal.get<HTMLVideoElement>("video").element;
    await modal.get('[data-testid="artifact-video-close"]').trigger("click"); await flushPromises();
    pending.resolve(); await flushPromises();
    expect(player.paused).toBe(true);
    expect(player.getAttribute("src")).toBe(URLS[0]);
    expect(view.findComponent(NModal).props("show")).toBe(false);
  });
  it("keeps the paused frame during the closing animation and ignores its outgoing toolbar", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    const player = modal.get<HTMLVideoElement>("video").element;
    const refresh = modal.get('[data-testid="artifact-video-refresh"]'), save = modal.get('[data-testid="artifact-video-save"]');
    await modal.get('[data-testid="artifact-video-close"]').trigger("click");
    expect(modal.get("video").element).toBe(player); expect(player.paused).toBe(true);
    await refresh.trigger("click"); await save.trigger("click"); await flushPromises();
    expect(client.openVideoPreview).toHaveBeenCalledOnce(); expect(client.saveVideo).not.toHaveBeenCalled();
  });
  it("does not let a late play restart the video replaced by refresh", async () => {
    const pending = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      return pending.promise.then(() => mediaDom.startPlayback(this));
    });
    const view = await mounted(), modal = await open(view), previous = modal.get<HTMLVideoElement>("video").element;
    await modal.get('[data-testid="artifact-video-refresh"]').trigger("click"); await mediaDom.decodeAll();
    pending.resolve(); await flushPromises();
    const current = modal.get<HTMLVideoElement>("video").element;
    expect(previous.paused).toBe(true); expect(current.paused).toBe(true);
    expect(current).not.toBe(previous);
  });
  it("does not pause a newly reopened owner when the previous play settles", async () => {
    const pending = deferred<void>();
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      return pending.promise.then(() => mediaDom.startPlayback(this));
    });
    const client = nativeClient(), view = await mounted(client), first = await open(view);
    const player = first.get<HTMLVideoElement>("video").element;
    await first.get('[data-testid="artifact-video-close"]').trigger("click"); await flushPromises();
    await open(view); pending.resolve(); await flushPromises();
    expect(dialog().get("video").element).toBe(player);
    expect(player.paused).toBe(false); expect(client.openVideoPreview).toHaveBeenCalledOnce();
    await dialog().get('[data-testid="artifact-video-close"]').trigger("click"); await flushPromises();
    mediaDom.startPlayback(player);
    expect(player.paused).toBe(true);
  });
  it("shares the first pending cover preparation with a click instead of restarting it", async () => {
    const pending = deferred<{ status: "opened"; previewUrl: string }>(), client = nativeClient();
    vi.mocked(client.openVideoPreview).mockReturnValueOnce(pending.promise);
    const view = await mounted(client, false); await open(view);
    pending.resolve({ status: "opened", previewUrl: URLS[0]! }); await mediaDom.decodeAll();
    expect(client.openVideoPreview).toHaveBeenCalledOnce(); expect(client.releaseVideoPreview).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });
  it("refreshes only on intent, detaches before release, keeps cover and focus, and ignores old events", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    const cover = view.get("canvas").element, previous = modal.get<HTMLVideoElement>("video");
    const painting = mediaDom.draws.get(cover)!;
    expect(painting).toHaveBeenCalledOnce();
    const release = deferred<{ status: "released" }>();
    vi.mocked(client.releaseVideoPreview).mockReturnValueOnce(release.promise);
    const button = modal.get<HTMLButtonElement>("[data-testid='artifact-video-refresh']");
    await button.trigger("click"); await button.trigger("click"); await flushPromises();
    expect(previous.element.getAttribute("src")).toBeNull();
    expect(client.openVideoPreview).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(button.element);
    expect(view.get("canvas").element).toBe(cover); expect(view.get("button").attributes("aria-busy")).toBe("false");
    expect(painting).toHaveBeenCalledOnce();
    release.resolve({ status: "released" }); await flushPromises();
    await previous.trigger("error"); await previous.trigger("loadedmetadata");
    await mediaDom.decodeAll();
    expect(modal.get("video").attributes("src")).toBe(URLS[1]);
    expect(modal.find("[role='alert']").exists()).toBe(false);
    expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });
  it("finishes a refresh while closed and reuses it when reopened", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    const pending = deferred<{ status: "opened"; previewUrl: string }>();
    vi.mocked(client.openVideoPreview).mockReturnValueOnce(pending.promise);
    await modal.get("[data-testid='artifact-video-refresh']").trigger("click"); await flushPromises();
    await modal.get("[data-testid='artifact-video-close']").trigger("click"); await flushPromises();
    pending.resolve({ status: "opened", previewUrl: URLS[1]! }); await mediaDom.decodeAll();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    await open(view);
    expect(dialog().get("video").attributes("src")).toBe(URLS[1]); expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
  });
  it("keeps the actual frame if the browser requires another play gesture", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error("Playback needs a gesture"));
    const view = await mounted(), modal = await open(view);
    expect((modal.get("video").element as HTMLVideoElement).currentTime).toBe(0.1);
    expect(modal.find("[role='alert']").exists()).toBe(false);
  });
  it("does not replay an obsolete opening intent after a quick close and reopen", async () => {
    const client = nativeClient(), view = await mounted(client, false);
    const first = await open(view);
    await first.get('[data-testid="artifact-video-close"]').trigger("click"); await flushPromises();
    await open(view); await mediaDom.decodeAll();
    expect(client.openVideoPreview).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
  });
  it("keeps playback and cover through metadata-only updates and seek", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view), player = modal.get("video").element;
    await view.setProps({ artifact: { ...view.props("artifact"), displayName: "新名称.mp4", sizeBytes: null } });
    await modal.get("video").trigger("seeking"); await modal.get("video").trigger("seeked");
    expect(modal.get("video").element).toBe(player); expect(modal.get(".artifact-video__metadata").text()).toBe("MP4");
    expect(client.openVideoPreview).toHaveBeenCalledOnce();
  });
  it("recovers a playback error without blocking the existing download action", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view);
    await modal.get("video").trigger("error"); await flushPromises();
    expect(modal.get("[role='alert']").text()).toContain("暂时无法播放");
    expect(view.find("canvas").exists()).toBe(true);
    await modal.get("[data-testid='artifact-video-save']").trigger("click"); await flushPromises();
    expect(client.saveVideo).toHaveBeenCalledExactlyOnceWith(CONTEXT, IDENTITY);
    await modal.get("[data-testid='artifact-video-retry']").trigger("click"); await mediaDom.decodeAll();
    expect(modal.get("video").attributes("src")).toBe(URLS[1]);
  });
  it.each(["artifact_native_expired", "artifact_native_forbidden", "artifact_native_not_found", "artifact_native_unsupported"] as const)("handles %s with clear feedback", async code => {
    const client = nativeClient();
    vi.mocked(client.openVideoPreview).mockRejectedValue(new ChatArtifactVideoNativeClientError({ schemaVersion: 1, requestId: null, code, retryable: false }));
    const view = await mounted(client), modal = await open(view);
    expect(modal.find("[role='alert']").exists()).toBe(true); expect(modal.find("video").exists()).toBe(false);
    expect(modal.find("[data-testid='artifact-video-retry']").exists()).toBe(false);
    expect(modal.get("[data-testid='artifact-video-refresh']").attributes("disabled")).toBeDefined();
  });
  it("deduplicates download, uses toasts and keeps cancellation silent", async () => {
    const client = nativeClient(), save = deferred<{ status: "saved"; code: null }>();
    vi.mocked(client.saveVideo).mockReturnValueOnce(save.promise);
    const view = await mounted(client), modal = await open(view), button = modal.get("[data-testid='artifact-video-save']");
    await button.trigger("click"); await button.trigger("click"); expect(client.saveVideo).toHaveBeenCalledOnce();
    save.resolve({ status: "saved", code: null }); await flushPromises();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("视频已保存。");
    vi.mocked(client.saveVideo).mockResolvedValueOnce({ status: "cancelled", code: null }); await button.trigger("click"); await flushPromises();
    expect(toast.success).toHaveBeenCalledOnce(); expect(toast.error).not.toHaveBeenCalled();
    vi.mocked(client.saveVideo).mockResolvedValueOnce({ status: "failed", code: "artifact_native_storage_full" }); await button.trigger("click"); await flushPromises();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("存储空间不足，视频未保存。");
  });
  it("suppresses late save feedback on a context change and closes the old player", async () => {
    const client = nativeClient(), view = await mounted(client), modal = await open(view), save = deferred<{ status: "saved"; code: null }>();
    vi.mocked(client.saveVideo).mockReturnValueOnce(save.promise);
    await modal.get("[data-testid='artifact-video-save']").trigger("click");
    await view.setProps({ contextId: NEXT_CONTEXT }); await mediaDom.decodeAll();
    save.resolve({ status: "saved", code: null }); await flushPromises();
    expect(toast.success).not.toHaveBeenCalled(); expect(view.findComponent(NModal).props("show")).toBe(false);
  });
  it.each([{ kind: "image", mediaType: "image/png" }, { status: "generating" }, { status: "expired" }] as const)("does not read ineligible artifacts: %j", async overrides => {
    const client = nativeClient(), view = mount(ChatArtifactVideo, { props: { artifact: artifact(overrides), contextId: CONTEXT, client } }); await flushPromises();
    expect(view.find("canvas,video").exists()).toBe(false); expect(client.openVideoPreview).not.toHaveBeenCalled();
  });
  it("has accessible cover and dialog names without axe violations", async () => {
    const view = await mounted(); expect((await axe.run(view.element)).violations).toEqual([]);
    const modal = await open(view); expect((await axe.run(modal.element)).violations).toEqual([]);
  });
});
