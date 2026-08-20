// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { ChatArtifactNativeClientError } from "../../api/chat-artifact-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactImage from "./ChatArtifactImage.vue";

const CONTEXT_A = "019c1a00-0000-7000-8000-000000000401";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000402";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000403";
const TURN_ID = "019c1a00-0000-7000-8000-000000000404";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000405";
const URL_A = `yijie-artifact-preview://localhost/v1/${"A".repeat(43)}`;
const URL_B = `yijie-artifact-preview://localhost/v1/${"B".repeat(43)}`;
const URL_C = `yijie-artifact-preview://localhost/v1/${"C".repeat(43)}`;

function artifact(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: ARTIFACT_ID,
    kind: "image",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "安全图片.png",
    mediaType: "image/png",
    sizeBytes: 32,
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

function nativeClient(urls: readonly string[] = [URL_A]): ChatArtifactNativeClient {
  let urlIndex = 0;
  return {
    openImagePreview: vi.fn(async () => ({
      status: "opened" as const,
      previewUrl: urls[Math.min(urlIndex++, urls.length - 1)]!,
    })),
    releaseImagePreview: vi.fn(async () => ({ status: "released" as const })),
    saveImage: vi.fn(async () => ({ status: "saved" as const, code: null })),
  };
}

async function readyWrapper(client = nativeClient([URL_A, URL_B, URL_C])) {
  const wrapper = mount(ChatArtifactImage, {
    attachTo: document.body,
    props: { artifact: artifact(), contextId: CONTEXT_A, client },
    global: { stubs: { teleport: true } },
  });
  await flushPromises();
  return wrapper;
}

describe("ChatArtifactImage", () => {
  it("fails closed for non-image or non-ready Artifacts", async () => {
    const client = nativeClient();
    const announced = mount(ChatArtifactImage, {
      props: { artifact: artifact({ status: "announced", mediaType: null, sizeBytes: null, localCommittedAt: null, expiresAt: null }), contextId: CONTEXT_A, client },
    });
    const video = mount(ChatArtifactImage, {
      props: { artifact: artifact({ kind: "video", mediaType: "video/mp4" }), contextId: CONTEXT_A, client },
    });
    await flushPromises();

    expect(announced.find(".artifact-image").exists()).toBe(false);
    expect(video.find(".artifact-image").exists()).toBe(false);
    expect(client.openImagePreview).not.toHaveBeenCalled();
  });

  it("opens one inline handle, renders a safe image, and never leaks forbidden metadata", async () => {
    const client = nativeClient();
    const wrapper = await readyWrapper(client);

    expect(client.openImagePreview).toHaveBeenCalledTimes(1);
    const image = wrapper.get("[data-testid='artifact-image-inline']");
    expect(image.attributes("src")).toBe(URL_A);
    expect(image.attributes("alt")).toBe("本地合成演示图片");
    await image.trigger("load");

    expect(wrapper.get("[data-testid='artifact-image-preview']").attributes("disabled")).toBeUndefined();
    expect(wrapper.get("[data-testid='artifact-image-save']").attributes("disabled")).toBeUndefined();
    expect(wrapper.html()).not.toMatch(/(?:base64|digest|sha256|hostHref|absolutePath|bearer|file:\/\/)/i);
    wrapper.unmount();
    await flushPromises();
    expect(client.releaseImagePreview).toHaveBeenCalled();
  });

  it("maps expiry safely and retries a failed image with a fresh handle", async () => {
    const expired = nativeClient();
    vi.mocked(expired.openImagePreview).mockRejectedValueOnce(new ChatArtifactNativeClientError({
      schemaVersion: 1,
      requestId: null,
      code: "artifact_native_expired",
      retryable: false,
    }));
    const expiredWrapper = await readyWrapper(expired);
    expect(expiredWrapper.get("[role='alert']").text()).toContain("已过期");
    expect(expiredWrapper.find("img").exists()).toBe(false);
    expiredWrapper.unmount();

    const client = nativeClient([URL_A, URL_B]);
    const wrapper = await readyWrapper(client);
    await wrapper.get("[data-testid='artifact-image-inline']").trigger("error");
    await flushPromises();
    expect(client.releaseImagePreview).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[role='alert']").text()).toContain("无法显示");

    await wrapper.get("[data-testid='artifact-image-retry']").trigger("click");
    await flushPromises();
    expect(client.openImagePreview).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[data-testid='artifact-image-inline']").attributes("src")).toBe(URL_B);
    wrapper.unmount();
  });

  it("uses a fresh lightbox handle, constrains zoom, handles Escape, and restores focus", async () => {
    const client = nativeClient([URL_A, URL_B]);
    const wrapper = await readyWrapper(client);
    await wrapper.get("[data-testid='artifact-image-inline']").trigger("load");
    const trigger = wrapper.get<HTMLButtonElement>("[data-testid='artifact-image-preview']");
    trigger.element.focus();
    await trigger.trigger("click");
    await flushPromises();

    expect(client.openImagePreview).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[data-testid='artifact-image-dialog-img']").attributes("src")).toBe(URL_B);
    await wrapper.get("[data-testid='artifact-image-dialog-img']").trigger("load");
    expect(document.activeElement).toBe(wrapper.get("[data-testid='artifact-image-close']").element);

    await wrapper.get("[data-testid='artifact-image-zoom-in']").trigger("click");
    await wrapper.get("[data-testid='artifact-image-zoom-in']").trigger("click");
    await wrapper.get("[data-testid='artifact-image-zoom-in']").trigger("click");
    expect(wrapper.get("[data-testid='artifact-image-zoom-value']").text()).toBe("200%");
    expect(wrapper.get("[data-testid='artifact-image-zoom-in']").attributes("disabled")).toBeDefined();
    await wrapper.get("[data-testid='artifact-image-reset']").trigger("click");
    expect(wrapper.get("[data-testid='artifact-image-zoom-value']").text()).toBe("100%");

    const modalSave = wrapper.get<HTMLButtonElement>("[data-testid='artifact-image-dialog-save']");
    modalSave.element.focus();
    await wrapper.get("[data-testid='artifact-image-dialog']").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get("[data-testid='artifact-image-close']").element);
    await wrapper.get("[data-testid='artifact-image-dialog']").trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(modalSave.element);
    await modalSave.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-image-dialog-feedback']").text()).toContain("已保存");

    await wrapper.get("[data-testid='artifact-image-dialog']").trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(wrapper.find("[data-testid='artifact-image-dialog']").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(client.releaseImagePreview).toHaveBeenCalled();
    wrapper.unmount();
  });

  it("drops stale open responses and releases them against their original context", async () => {
    const first = deferred<{ status: "opened"; previewUrl: string }>();
    const second = deferred<{ status: "opened"; previewUrl: string }>();
    const client = nativeClient();
    vi.mocked(client.openImagePreview)
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const wrapper = mount(ChatArtifactImage, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });
    await flushPromises();
    await wrapper.setProps({ contextId: CONTEXT_B });
    await flushPromises();
    expect(client.openImagePreview).toHaveBeenCalledTimes(2);

    first.resolve({ status: "opened", previewUrl: URL_A });
    await flushPromises();
    second.resolve({ status: "opened", previewUrl: URL_B });
    await flushPromises();

    expect(wrapper.get("[data-testid='artifact-image-inline']").attributes("src")).toBe(URL_B);
    expect(client.releaseImagePreview).toHaveBeenCalledWith(CONTEXT_A, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: ARTIFACT_ID,
    });
    wrapper.unmount();
  });

  it("deduplicates save intent and exposes only content-free saved, cancelled, and failed feedback", async () => {
    const save = deferred<{ status: "saved"; code: null }>();
    const client = nativeClient();
    vi.mocked(client.saveImage).mockImplementationOnce(async () => save.promise);
    const wrapper = await readyWrapper(client);
    await wrapper.get("[data-testid='artifact-image-inline']").trigger("load");
    const button = wrapper.get("[data-testid='artifact-image-save']");

    await button.trigger("click");
    await button.trigger("click");
    expect(client.saveImage).toHaveBeenCalledTimes(1);
    save.resolve({ status: "saved", code: null });
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-image-feedback']").text()).toContain("已保存");

    vi.mocked(client.saveImage).mockResolvedValueOnce({ status: "cancelled", code: null });
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-image-feedback']").text()).toContain("已取消");

    vi.mocked(client.saveImage).mockResolvedValueOnce({ status: "failed", code: "artifact_native_storage_full" });
    await button.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-image-feedback']").text()).toContain("存储空间不足");
    expect(wrapper.html()).not.toMatch(/(?:\/Users\/|output\.png|digest|base64|bearer)/i);
    wrapper.unmount();
  });

  it("keeps the ready renderer and lightbox accessible with reduced motion coverage", async () => {
    const wrapper = await readyWrapper();
    await wrapper.get("[data-testid='artifact-image-inline']").trigger("load");
    await wrapper.get("[data-testid='artifact-image-preview']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='artifact-image-dialog-img']").trigger("load");

    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    const source = readFileSync("src/components/chat/ChatArtifactImage.vue", "utf8");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    wrapper.unmount();
  });
});
