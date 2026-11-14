// @vitest-environment happy-dom
import { defineComponent, h, ref } from "vue";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactProjection } from "../../domain/chat-artifact";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ChatArtifactVideoNativeClient } from "../../api/chat-artifact-video-native-client";
import { provideArtifactMediaCache } from "../../composables/chat-artifact-media-cache";
import { installArtifactMediaDom } from "../../../tests/unit/artifact-media-dom";
import ChatArtifactImage from "./ChatArtifactImage.vue";
import ChatArtifactVideo from "./ChatArtifactVideo.vue";
vi.mock("naive-ui", async original => ({ ...await original<typeof import("naive-ui")>(), useMessage: () => ({ success: vi.fn(), error: vi.fn() }) }));
let mediaDom: ReturnType<typeof installArtifactMediaDom>;
enableAutoUnmount(afterEach);
beforeEach(() => { mediaDom = installArtifactMediaDom(); });
afterEach(async () => { await flushPromises(); document.body.innerHTML = ""; vi.restoreAllMocks(); });
function artifact(id: string, kind: "image" | "video"): ArtifactProjection {
  return { sessionId: `session-${id}`, turnId: "turn", artifactId: id, kind, provenance: "synthetic", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: `${id}.${kind === "image" ? "png" : "mp4"}`, mediaType: kind === "image" ? "image/png" : "video/mp4", sizeBytes: 4000,
    localCommittedAt: 1_000, expiresAt: Math.floor(Date.now() / 1000) + 3600, hasPoster: false, errorCode: null, retryable: null };
}
function harness() {
  const videos = ["a", "b", "c"].map(id => artifact(id, "video")), image = artifact("image", "image");
  const selection = ref<ArtifactProjection>(videos[0]!);
  const context = ref("context-a"), allowed = ref(true), present = ref(true);
  let sequence = 0;
  const videoClient: ChatArtifactVideoNativeClient = {
    openVideoPreview: vi.fn<ChatArtifactVideoNativeClient["openVideoPreview"]>(async () => ({ status: "opened", previewUrl: `yijie-artifact-video://localhost/v1/${String(++sequence).padStart(43, "A")}` })),
    releaseVideoPreview: vi.fn<ChatArtifactVideoNativeClient["releaseVideoPreview"]>(async () => ({ status: "released" })), saveVideo: vi.fn<ChatArtifactVideoNativeClient["saveVideo"]>(async () => ({ status: "saved", code: null })),
  };
  const imageClient: ChatArtifactNativeClient = {
    openImagePreview: vi.fn<ChatArtifactNativeClient["openImagePreview"]>(async () => ({ status: "opened", previewUrl: `yijie-artifact-preview://localhost/v1/${String(++sequence).padStart(43, "A")}` })),
    releaseImagePreview: vi.fn<ChatArtifactNativeClient["releaseImagePreview"]>(async () => ({ status: "released" })), copyImage: vi.fn<ChatArtifactNativeClient["copyImage"]>(async () => ({ status: "copied" })), saveImage: vi.fn<ChatArtifactNativeClient["saveImage"]>(async () => ({ status: "saved", code: null })),
  };
  const Host = defineComponent({ setup() {
    provideArtifactMediaCache(() => context.value, () => allowed.value);
    return () => {
      if (!present.value) return null;
      const props = { key: selection.value.artifactId, artifact: selection.value, contextId: context.value };
      return selection.value.kind === "image" ? h(ChatArtifactImage, { ...props, client: imageClient }) : h(ChatArtifactVideo, { ...props, client: videoClient });
    };
  } });
  const view = mount(Host, { attachTo: document.body, global: { stubs: { transition: false } } });
  return { view, selection, context, allowed, present, videos, image, videoClient, imageClient };
}
function dialog() { return new DOMWrapper(document.querySelector<HTMLElement>('[role="dialog"]')!); }

describe("conversation media reuse", () => {
  it("restores images and videos after real child unmounts without opening new native previews", async () => {
    const state = harness(); await mediaDom.decodeAll();
    await state.view.get('[data-testid="artifact-video-preview"]').trigger("click"); await flushPromises();
    const video = dialog().get<HTMLVideoElement>("video").element;
    video.currentTime = 3;
    state.selection.value = state.image; await mediaDom.decodeAll();
    expect(video.paused).toBe(true);
    await state.view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    const image = dialog().get("img").element;
    state.selection.value = state.videos[0]!; await flushPromises();
    expect(state.view.get('[data-testid="artifact-video-preview"]').attributes("aria-busy")).toBe("false");
    expect(state.view.find("canvas").exists()).toBe(true);
    await state.view.get('[data-testid="artifact-video-preview"]').trigger("click"); await flushPromises();
    expect(dialog().get("video").element).toBe(video); expect(video.currentTime).toBe(3);
    state.selection.value = state.image; await flushPromises();
    expect(state.view.find('[data-testid="artifact-image-loading"]').exists()).toBe(false);
    await state.view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    expect(dialog().get("img").element).toBe(image);
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledOnce(); expect(state.imageClient.openImagePreview).toHaveBeenCalledOnce();
  });
  it("keeps same-named content distinct through repeated switches among six tasks", async () => {
    const state = harness();
    const images = [0, 1, 2].map(index => ({ ...state.image, sessionId: `image-session-${index}`, artifactId: `image-${index}`, displayName: "同名图片.png" }));
    const imageNodes = new Map<string, Element>();
    for (const value of [...state.videos, ...images]) {
      state.selection.value = value; await mediaDom.decodeAll();
      if (value.kind === "image") imageNodes.set(value.artifactId, state.view.get('[data-testid="artifact-image-inline"]').element);
    }
    expect(new Set([...imageNodes.values()].map(element => element.getAttribute("src"))).size).toBe(3);
    const sequence = [images[1]!, state.videos[0]!, images[0]!, state.videos[2]!, images[2]!, state.videos[1]!];
    for (let round = 0; round < 3; round++) for (const value of sequence) {
      state.selection.value = value; await flushPromises();
      if (value.kind === "image") {
        expect(state.view.get('[data-testid="artifact-image-inline"]').element).toBe(imageNodes.get(value.artifactId));
        expect(state.view.find('[data-testid="artifact-image-loading"]').exists()).toBe(false);
      } else {
        expect(state.view.find('[data-testid="artifact-video-thumbnail"]').exists()).toBe(true);
        expect(state.view.get('[data-testid="artifact-video-preview"]').attributes("aria-busy")).toBe("false");
      }
    }
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(3);
    expect(state.imageClient.openImagePreview).toHaveBeenCalledTimes(3);
  });
  it("stops a previous task's late playback without affecting the current task", async () => {
    const state = harness(); await mediaDom.decodeAll();
    let resume!: () => void;
    const pending = new Promise<void>(resolve => { resume = resolve; });
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(function (this: HTMLMediaElement) {
      return pending.then(() => mediaDom.startPlayback(this));
    });
    await state.view.get('[data-testid="artifact-video-preview"]').trigger("click"); await flushPromises();
    const previous = dialog().get<HTMLVideoElement>("video").element;
    state.selection.value = state.videos[1]!; await mediaDom.decodeAll();
    await state.view.get('[data-testid="artifact-video-preview"]').trigger("click"); await flushPromises();
    const current = dialog().get<HTMLVideoElement>("video").element;
    resume(); await flushPromises();
    expect(previous.paused).toBe(true); expect(current.paused).toBe(false);
    expect(previous.getAttribute("src")).not.toBe(current.getAttribute("src"));
    expect(dialog().get("strong").text()).toBe("b.mp4");
  });
  it("does not reacquire an evicted player just to show its retained cover", async () => {
    const state = harness(); await mediaDom.decodeAll();
    for (const value of state.videos.slice(1)) { state.selection.value = value; await mediaDom.decodeAll(); }
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(3);
    state.selection.value = state.videos[0]!; await flushPromises();
    expect(state.view.find("canvas").exists()).toBe(true);
    expect(state.view.get('[data-testid="artifact-video-preview"]').attributes("aria-busy")).toBe("false");
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(3);
    await state.view.get('[data-testid="artifact-video-preview"]').trigger("click"); await mediaDom.decodeAll();
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(4);
    expect(dialog().find("video").exists()).toBe(true);
  });
  it("clears visible and cached media when permission changes and reloads only after authority returns", async () => {
    const state = harness(); await mediaDom.decodeAll();
    const previous = mediaDom.videos[0]!;
    state.allowed.value = false; await flushPromises();
    expect(state.view.find('[data-testid="artifact-video-preview"]').exists()).toBe(false);
    expect(previous.getAttribute("src")).toBeNull();
    state.allowed.value = true; await mediaDom.decodeAll();
    expect(state.view.find("canvas").exists()).toBe(true);
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(2);
    state.context.value = "context-b"; await mediaDom.decodeAll();
    expect(state.videoClient.openVideoPreview).toHaveBeenCalledTimes(3);
    expect(state.videoClient.openVideoPreview).toHaveBeenLastCalledWith("context-b", expect.objectContaining({ artifactId: "a" }));
  });
  it("reuses a completed refresh after the conversation was temporarily absent", async () => {
    const state = harness(); state.selection.value = state.image; await mediaDom.decodeAll();
    await state.view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    await dialog().get('[data-testid="artifact-image-refresh"]').trigger("click"); await flushPromises();
    state.present.value = false; await mediaDom.decodeAll();
    state.present.value = true; await flushPromises();
    expect(state.view.find('[data-testid="artifact-image-loading"]').exists()).toBe(false);
    expect(state.imageClient.openImagePreview).toHaveBeenCalledTimes(2);
  });
});
