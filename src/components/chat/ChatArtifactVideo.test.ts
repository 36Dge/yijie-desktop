// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { ChatArtifactVideoNativeClientError } from "../../api/chat-artifact-video-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactVideo from "./ChatArtifactVideo.vue";

const CONTEXT_A = "019c1a00-0000-7000-8000-000000000501";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000502";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000503";
const TURN_ID = "019c1a00-0000-7000-8000-000000000504";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000505";
const ARTIFACT_B = "019c1a00-0000-7000-8000-000000000506";
const URL_A = `yijie-artifact-video://localhost/v1/${"A".repeat(43)}`;
const URL_B = `yijie-artifact-video://localhost/v1/${"B".repeat(43)}`;

function artifact(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: ARTIFACT_ID,
    kind: "video",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "本地合成视频.mp4",
    mediaType: "video/mp4",
    sizeBytes: 1_642,
    localCommittedAt: 1_000,
    expiresAt: 605_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nativeClient(urls: readonly string[] = [URL_A]): ChatArtifactVideoNativeClient {
  let index = 0;
  return {
    openVideoPreview: vi.fn(async () => ({
      status: "opened" as const,
      previewUrl: urls[Math.min(index++, urls.length - 1)]!,
    })),
    releaseVideoPreview: vi.fn(async () => ({ status: "released" as const })),
    saveVideo: vi.fn(async () => ({ status: "saved" as const, code: null })),
  };
}

async function mountedReady(client = nativeClient([URL_A, URL_B])) {
  const wrapper = mount(ChatArtifactVideo, {
    attachTo: document.body,
    props: { artifact: artifact(), contextId: CONTEXT_A, client },
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatArtifactVideo", () => {
  it("fails closed for non-video and non-ready Artifacts", async () => {
    const client = nativeClient();
    const image = mount(ChatArtifactVideo, {
      props: { artifact: artifact({ kind: "image", mediaType: "image/png" }), contextId: CONTEXT_A, client },
    });
    const announced = mount(ChatArtifactVideo, {
      props: {
        artifact: artifact({ status: "announced", mediaType: null, sizeBytes: null, localCommittedAt: null, expiresAt: null }),
        contextId: CONTEXT_A,
        client,
      },
    });
    await flushPromises();

    expect(image.find("video").exists()).toBe(false);
    expect(announced.find("video").exists()).toBe(false);
    expect(client.openVideoPreview).not.toHaveBeenCalled();
  });

  it("opens one handle and renders only safe native video controls", async () => {
    const client = nativeClient();
    const wrapper = await mountedReady(client);
    const video = wrapper.get("[data-testid='artifact-video-media']");

    expect(client.openVideoPreview).toHaveBeenCalledTimes(1);
    expect(video.attributes("src")).toBe(URL_A);
    expect(video.attributes("controls")).toBeDefined();
    expect(video.attributes("preload")).toBe("metadata");
    expect(video.attributes("autoplay")).toBeUndefined();
    expect(video.attributes("loop")).toBeUndefined();
    expect(video.attributes("disablepictureinpicture")).toBeDefined();
    expect(video.attributes("disableremoteplayback")).toBeDefined();
    expect(video.attributes("controlslist")).toContain("nodownload");
    expect(video.attributes("controlslist")).toContain("noremoteplayback");
    expect(wrapper.get(".artifact-video").attributes("aria-busy")).toBe("true");

    await video.trigger("loadedmetadata");
    expect(wrapper.get(".artifact-video").attributes("aria-busy")).toBe("false");
    expect(wrapper.get("[data-testid='artifact-video-state']").text()).toContain("可以播放");
    expect(wrapper.html()).not.toMatch(/(?:base64|sha256|digest|hostHref|file:\/\/|\/Users\/|bearer|token)/i);
    wrapper.unmount();
  });

  it("keeps one handle through seek and never reopens or releases it", async () => {
    const client = nativeClient();
    const wrapper = await mountedReady(client);
    const video = wrapper.get("[data-testid='artifact-video-media']");
    await video.trigger("loadedmetadata");
    await video.trigger("seeking");
    await video.trigger("seeked");

    expect(client.openVideoPreview).toHaveBeenCalledTimes(1);
    expect(client.releaseVideoPreview).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("pauses, clears src, calls load, then releases on fatal error and retries with a fresh URL", async () => {
    const order: string[] = [];
    vi.mocked(HTMLMediaElement.prototype.pause).mockImplementation(() => { order.push("pause"); });
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(() => { order.push("load"); });
    const client = nativeClient([URL_A, URL_B]);
    vi.mocked(client.releaseVideoPreview).mockImplementation(async () => {
      order.push("release");
      return { status: "released" };
    });
    const wrapper = await mountedReady(client);
    const video = wrapper.get("[data-testid='artifact-video-media']");
    const removeAttribute = video.element.removeAttribute.bind(video.element);
    vi.spyOn(video.element, "removeAttribute").mockImplementation((name: string) => {
      if (name === "src") order.push("clear-src");
      removeAttribute(name);
    });

    await video.trigger("error");
    await flushPromises();
    expect(order.slice(0, 4)).toEqual(["pause", "clear-src", "load", "release"]);
    const retry = wrapper.get<HTMLButtonElement>("[data-testid='artifact-video-retry']");
    retry.element.focus();
    await retry.trigger("click");
    await flushPromises();
    const retried = wrapper.get("[data-testid='artifact-video-media']");
    expect(client.openVideoPreview).toHaveBeenCalledTimes(2);
    expect(retried.attributes("src")).toBe(URL_B);
    await retried.trigger("loadedmetadata");
    expect(document.activeElement).toBe(retried.element);
    wrapper.unmount();
  });

  it("maps native expiry without exposing native details", async () => {
    const client = nativeClient();
    vi.mocked(client.openVideoPreview).mockRejectedValueOnce(new ChatArtifactVideoNativeClientError({
      schemaVersion: 1,
      requestId: null,
      code: "artifact_native_expired",
      retryable: false,
    }));
    const wrapper = await mountedReady(client);
    expect(wrapper.get("[role='alert']").text()).toContain("已过期");
    expect(wrapper.find("video").exists()).toBe(false);
    expect(wrapper.find("[data-testid='artifact-video-retry']").exists()).toBe(false);
    wrapper.unmount();
  });

  it("releases stale opens against their issuing context without polluting current UI", async () => {
    const first = deferred<{ status: "opened"; previewUrl: string }>();
    const second = deferred<{ status: "opened"; previewUrl: string }>();
    const client = nativeClient();
    vi.mocked(client.openVideoPreview)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const wrapper = mount(ChatArtifactVideo, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });
    await flushPromises();
    await wrapper.setProps({ contextId: CONTEXT_B });
    await flushPromises();
    first.resolve({ status: "opened", previewUrl: URL_A });
    await flushPromises();
    second.resolve({ status: "opened", previewUrl: URL_B });
    await flushPromises();

    expect(wrapper.get("video").attributes("src")).toBe(URL_B);
    expect(client.releaseVideoPreview).toHaveBeenCalledWith(CONTEXT_A, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: ARTIFACT_ID,
    });
    wrapper.unmount();
  });

  it("cleans up the old media session for context, status, artifact, and unmount changes", async () => {
    const client = nativeClient([URL_A, URL_B]);
    const wrapper = await mountedReady(client);
    await wrapper.setProps({ artifact: artifact({ artifactId: ARTIFACT_B }) });
    await flushPromises();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(client.releaseVideoPreview).toHaveBeenCalledWith(CONTEXT_A, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: ARTIFACT_ID,
    });

    await wrapper.setProps({ artifact: artifact({ artifactId: ARTIFACT_B, status: "expired" }) });
    await flushPromises();
    expect(client.releaseVideoPreview).toHaveBeenCalledWith(CONTEXT_A, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: ARTIFACT_B,
    });
    wrapper.unmount();
    await flushPromises();
  });

  it("deduplicates save and exposes only content-free saved, cancelled, and failed feedback", async () => {
    const save = deferred<{ status: "saved"; code: null }>();
    const client = nativeClient();
    vi.mocked(client.saveVideo).mockImplementationOnce(async () => save.promise);
    const wrapper = await mountedReady(client);
    await wrapper.get("video").trigger("loadedmetadata");
    const button = wrapper.get("[data-testid='artifact-video-save']");
    await button.trigger("click");
    await button.trigger("click");
    expect(client.saveVideo).toHaveBeenCalledTimes(1);
    save.resolve({ status: "saved", code: null });
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-video-feedback']").text()).toContain("已保存");

    vi.mocked(client.saveVideo).mockResolvedValueOnce({ status: "cancelled", code: null });
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-video-feedback']").text()).toContain("已取消");

    vi.mocked(client.saveVideo).mockResolvedValueOnce({ status: "failed", code: "artifact_native_storage_full" });
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-video-feedback']").text()).toContain("存储空间不足");
    expect(wrapper.text()).not.toMatch(/(?:\/Users\/|output\.mp4|digest|base64|bearer|token)/i);
    wrapper.unmount();
  });

  it("is keyboard accessible, axe-clean, and has an explicit reduced-motion boundary", async () => {
    const wrapper = await mountedReady();
    await wrapper.get("video").trigger("loadedmetadata");
    expect(wrapper.get("video").attributes("tabindex")).toBe("0");
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    const source = readFileSync("src/components/chat/ChatArtifactVideo.vue", "utf8");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toMatch(/console\.|\.fetch\(|localStorage|sessionStorage/);
    wrapper.unmount();
  });
});
