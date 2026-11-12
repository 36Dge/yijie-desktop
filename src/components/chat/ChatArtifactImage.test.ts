// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import axe from "axe-core";
import { defineComponent } from "vue";
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { NModal } from "naive-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import { ChatArtifactNativeClientError } from "../../api/chat-artifact-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactImage from "./ChatArtifactImage.vue";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("naive-ui", async original => ({ ...await original<typeof import("naive-ui")>(), useMessage: () => toast }));
beforeEach(() => { toast.success.mockClear(); toast.error.mockClear(); });

const CONTEXT_A = "019c1a00-0000-7000-8000-000000000401";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000402";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000403";
const TURN_ID = "019c1a00-0000-7000-8000-000000000404";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000405";
const IDENTITY = { sessionId: SESSION_ID, turnId: TURN_ID, artifactId: ARTIFACT_ID };
const URL_A = `yijie-artifact-preview://localhost/v1/${"A".repeat(43)}`;
const URL_B = `yijie-artifact-preview://localhost/v1/${"B".repeat(43)}`;
const URL_C = `yijie-artifact-preview://localhost/v1/${"C".repeat(43)}`;
enableAutoUnmount(afterEach);
const modal = defineComponent({ props: ["show"], template: '<slot v-if="show"/>' });
const popover = defineComponent({ props: ["show"], emits: ["update:show"], template: '<div><span @click="$emit(\'update:show\', !show)"><slot name="trigger"/></span><div v-if="show"><slot/></div></div>' });

function artifact(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: ARTIFACT_ID, kind: "image", provenance: "provider", status: "ready", ordinal: 0,
    progressStage: null, progressPercent: null, displayName: "江南烟雨-水墨写意.jpg", mediaType: "image/jpeg",
    sizeBytes: 32, localCommittedAt: 1_000, expiresAt: 605_801_000, hasPoster: false, errorCode: null, retryable: null,
    ...overrides,
  }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function nativeClient(): ChatArtifactNativeClient {
  let index = 0;
  const urls = [URL_A, URL_B, URL_C];
  return {
    openImagePreview: vi.fn(async () => ({ status: "opened" as const, previewUrl: urls[Math.min(index++, 2)]! })),
    releaseImagePreview: vi.fn(async () => ({ status: "released" as const })),
    saveImage: vi.fn(async () => ({ status: "saved" as const, code: null })),
    copyImage: vi.fn(async () => ({ status: "copied" as const })),
  };
}
async function readyWrapper(client = nativeClient()) {
  const wrapper = mount(ChatArtifactImage, {
    attachTo: document.body,
    props: { artifact: artifact(), contextId: CONTEXT_A, client },
    global: { stubs: { NModal: modal, Modal: modal, NPopover: popover, Popover: popover } },
  });
  await flushPromises();
  return wrapper;
}
type View = Awaited<ReturnType<typeof readyWrapper>>;
async function menu(view: View) {
  await view.get('[data-testid="artifact-image-more"]').trigger("keydown", { key: "ArrowDown" });
  await flushPromises();
}
async function viewer(view: View) {
  await view.get('[data-testid="artifact-image-inline"]').trigger("load");
  await view.get('[data-testid="artifact-image-preview"]').trigger("click");
  await flushPromises();
  await view.get('[data-testid="artifact-image-dialog-img"]').trigger("load");
}

describe("ChatArtifactImage", () => {
  it("presents the image and readable title without the metadata card or permanent actions", async () => {
    const client = nativeClient();
    const view = await readyWrapper(client);
    expect(view.get("figcaption").text()).toBe("江南烟雨-水墨写意");
    expect(view.find(".artifact-shell").exists()).toBe(false);
    expect(view.text()).not.toMatch(/JPEG|32 B|服务生成|已就绪|保存图片/);
    expect(view.find('[role="menu"]').exists()).toBe(false);
    expect(view.get('[data-testid="artifact-image-more"]').attributes("data-yj-tooltip")).toBe("图片操作");
    expect(client.openImagePreview).toHaveBeenCalledExactlyOnceWith(CONTEXT_A, IDENTITY);
    await view.get("img").trigger("load");
    expect(view.get('[data-testid="artifact-image-preview"]').attributes("disabled")).toBeUndefined();
    expect(view.html()).not.toMatch(/(?:base64|digest|sha256|hostHref|absolutePath|bearer|file:\/\/)/i);
  });

  it.each(["announced", "generating", "processing", "transferring"] as const)("animates %s without opening or copying unfinished content", async status => {
    const client = nativeClient();
    const view = mount(ChatArtifactImage, { props: { artifact: artifact({ status, displayName: null }), contextId: CONTEXT_A, client } });
    await flushPromises();
    expect(view.get('[data-testid="artifact-image-loading"]').text()).toBe(status === "transferring" ? "加载中…" : "生成中…");
    expect(view.get("figcaption").text()).toBe("生成的图片");
    expect(view.find("button").exists()).toBe(false);
    expect(client.openImagePreview).not.toHaveBeenCalled();
    expect(client.copyImage).not.toHaveBeenCalled();
  });

  it("offers three keyboard actions, leaves quote disabled, and copies through the scoped native client", async () => {
    const client = nativeClient();
    const view = await readyWrapper(client);
    await menu(view);
    const items = view.findAll('[role="menuitem"]');
    expect(items.map(item => item.text())).toEqual(["引用到对话", "复制图片", "下载图片"]);
    expect(items[0]!.attributes("disabled")).toBeDefined();
    expect(document.activeElement).toBe(items[1]!.element);
    await view.get('[role="menu"]').trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[2]!.element);
    await items[1]!.trigger("click"); await flushPromises();
    expect(client.copyImage).toHaveBeenCalledExactlyOnceWith(CONTEXT_A, IDENTITY);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("已复制");
    expect(view.find('[data-testid="artifact-image-feedback"]').exists()).toBe(false);
    expect(view.text()).not.toContain("已复制");
    expect(view.find('[role="menu"]').exists()).toBe(false);
    expect(view.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(view.get('[data-testid="artifact-image-more"]').element);
  });

  it("gives a pointer-opened menu keyboard ownership and dismisses it with Escape", async () => {
    const view = await readyWrapper();
    const trigger = view.get('[data-testid="artifact-image-more"]');
    await trigger.trigger("click"); await flushPromises();
    const popup = view.get('[role="menu"]');
    expect(document.activeElement).toBe(popup.element);
    expect(trigger.attributes("aria-controls")).toBe(popup.attributes("id"));
    await popup.trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(view.get('[data-testid="artifact-image-save"]').element);
    await popup.trigger("keydown", { key: "Escape" }); await flushPromises();
    expect(view.find('[role="menu"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });

  it("retains download independently of preview decoding and uses toasts for save/errors and keeps cancellation silent", async () => {
    const client = nativeClient();
    const view = await readyWrapper(client);
    expect(view.get('[data-testid="artifact-image-preview"]').attributes("disabled")).toBeDefined();
    await menu(view); await view.get('[data-testid="artifact-image-save"]').trigger("click"); await flushPromises();
    expect(client.saveImage).toHaveBeenCalledWith(CONTEXT_A, IDENTITY);
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("图片已保存");
    expect(view.text()).not.toContain("图片已保存");
    vi.mocked(client.saveImage).mockResolvedValueOnce({ status: "cancelled", code: null });
    await menu(view); await view.get('[data-testid="artifact-image-save"]').trigger("click"); await flushPromises();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(view.text()).not.toContain("已取消下载");
    vi.mocked(client.saveImage).mockResolvedValueOnce({ status: "failed", code: "artifact_native_storage_full" });
    await menu(view); await view.get('[data-testid="artifact-image-save"]').trigger("click"); await flushPromises();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("存储空间不足，图片未保存。");
  });

  it("deduplicates copy and save, permits retry, and suppresses feedback after a context switch", async () => {
    const client = nativeClient(); const copy = deferred<{ status: "copied" }>();
    vi.mocked(client.copyImage).mockReturnValueOnce(copy.promise);
    const view = await readyWrapper(client);
    await menu(view); await view.get('[data-testid="artifact-image-copy"]').trigger("click");
    await menu(view);
    expect(view.get('[data-testid="artifact-image-save"]').attributes("disabled")).toBeDefined();
    await view.get('[data-testid="artifact-image-copy"]').trigger("click");
    expect(client.copyImage).toHaveBeenCalledTimes(1);
    await view.setProps({ contextId: CONTEXT_B }); await flushPromises();
    copy.resolve({ status: "copied" }); await flushPromises();
    expect(toast.success).not.toHaveBeenCalled();
    expect(view.find('[data-testid="artifact-image-feedback"]').exists()).toBe(false);
    vi.mocked(client.copyImage).mockRejectedValueOnce(new ChatArtifactNativeClientError({ schemaVersion: 1, requestId: null, code: "artifact_native_unavailable", retryable: false }));
    await menu(view); await view.get('[data-testid="artifact-image-copy"]').trigger("click"); await flushPromises();
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("图片复制失败，请重试。");
    await menu(view); await view.get('[data-testid="artifact-image-copy"]').trigger("click"); await flushPromises();
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("已复制");
  });

  it.each([
    ["artifact_native_expired", "图片已过期"],
    ["artifact_native_not_found", "图片内容不可用"],
    ["artifact_native_forbidden", "当前没有权限"],
  ] as const)("maps ordinary %s without regenerating", async (code, text) => {
    const client = nativeClient();
    vi.mocked(client.openImagePreview).mockRejectedValueOnce(new ChatArtifactNativeClientError({ schemaVersion: 1, requestId: null, code, retryable: false }));
    const view = await readyWrapper(client);
    expect(view.get('[role="alert"]').text()).toContain(text);
    expect(view.find("img").exists()).toBe(false);
    expect(view.find('[data-testid="artifact-image-retry"]').exists()).toBe(false);
    expect(client.openImagePreview).toHaveBeenCalledTimes(1);
  });

  it("retries an ordinary preview failure with a fresh handle", async () => {
    const client = nativeClient(); const view = await readyWrapper(client);
    await view.get("img").trigger("error"); await flushPromises();
    expect(client.releaseImagePreview).toHaveBeenCalledTimes(1);
    await view.get('[data-testid="artifact-image-retry"]').trigger("click"); await flushPromises();
    expect(view.get("img").attributes("src")).toBe(URL_B);
  });

  it("opens and refreshes a large viewer, zooms below and above fit, and restores focus", async () => {
    const client = nativeClient(); const view = await readyWrapper(client);
    await viewer(view);
    expect(view.get('[data-testid="artifact-image-dialog-img"]').attributes("src")).toBe(URL_B);
    const modal = view.get('[role="dialog"]');
    expect(modal.get("header").text()).toContain("江南烟雨-水墨写意");
    expect(modal.findAll("header button").map(button => button.attributes("aria-label"))).toEqual(["关闭图片预览", "刷新预览"]);
    expect(modal.findAll("button")).toHaveLength(2);
    await modal.trigger("keydown", { key: "-" });
    expect(view.get("output").text()).toBe("90%");
    await view.get(".artifact-image__viewport").trigger("wheel", { deltaY: 120, deltaMode: 0 });
    expect(Number(view.get("output").text().replace("%", ""))).toBeLessThan(90);
    await modal.trigger("keydown", { key: "0" });
    expect(view.get("output").text()).toBe("100%");
    for (let index = 0; index < 40; index++) await modal.trigger("keydown", { key: "+" });
    expect(view.get("output").text()).toBe("400%");
    await view.get('[data-testid="artifact-image-refresh"]').trigger("click"); await flushPromises();
    expect(client.releaseImagePreview).toHaveBeenCalledWith(CONTEXT_A, IDENTITY);
    expect(view.get('[data-testid="artifact-image-dialog-img"]').attributes("src")).toBe(URL_C);
    expect(client.openImagePreview).toHaveBeenCalledTimes(3);
    expect(client.copyImage).not.toHaveBeenCalled();
    await modal.trigger("keydown", { key: "Escape" }); await flushPromises();
    expect(view.find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(view.get('[data-testid="artifact-image-preview"]').element);
  });

  it("drops stale open responses and releases them against the original context", async () => {
    const first = deferred<{ status: "opened"; previewUrl: string }>();
    const second = deferred<{ status: "opened"; previewUrl: string }>();
    const client = nativeClient();
    vi.mocked(client.openImagePreview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = await readyWrapper(client);
    await view.setProps({ contextId: CONTEXT_B }); await flushPromises();
    first.resolve({ status: "opened", previewUrl: URL_A }); await flushPromises();
    second.resolve({ status: "opened", previewUrl: URL_B }); await flushPromises();
    expect(view.get("img").attributes("src")).toBe(URL_B);
    expect(client.releaseImagePreview).toHaveBeenCalledWith(CONTEXT_A, IDENTITY);
  });

  it("accumulates fine wheel movement and handles a WebKit pinch relative to gesture start", async () => {
    const view = await readyWrapper(); await viewer(view);
    const viewport = view.get(".artifact-image__viewport");
    for (let index = 0; index < 10; index++) await viewport.trigger("wheel", { deltaY: 1, deltaMode: 0 });
    expect(view.get("output").text()).toBe("98%");
    await view.get('[role="dialog"]').trigger("keydown", { key: "0" });
    await viewport.trigger("gesturestart");
    await viewport.trigger("gesturechange", { scale: 0.7 });
    expect(view.get("output").text()).toBe("70%");
    await viewport.trigger("gesturechange", { scale: 1.5 });
    expect(view.get("output").text()).toBe("150%");
    await viewport.trigger("gestureend");
    await viewport.trigger("gesturestart");
    await viewport.trigger("gesturechange", { scale: 2 });
    expect(view.get("output").text()).toBe("300%");
    await viewport.trigger("gestureend");
  });

  it("ignores image decode events belonging to a preview already replaced by refresh", async () => {
    const view = await readyWrapper(); await viewer(view);
    const previous = view.get('[data-testid="artifact-image-dialog-img"]');
    await view.get('[data-testid="artifact-image-refresh"]').trigger("click"); await flushPromises();
    expect(view.find("output").exists()).toBe(false);
    await previous.trigger("error"); await flushPromises();
    expect(view.find('[role="alert"]').exists()).toBe(false);
    await view.get('[data-testid="artifact-image-dialog-img"]').trigger("load");
    expect(view.get("output").text()).toBe("100%");
  });

  it("keeps refresh focus during loading and lets the real modal close on document Escape", async () => {
    const client = nativeClient();
    // The real Transition leaves the dialog beside FocusTrap's sentinels;
    // VTU's transition-stub wrapper changes that DOM contract.
    const view = mount(ChatArtifactImage, { attachTo: document.body, props: { artifact: artifact(), contextId: CONTEXT_A, client }, global: { stubs: { transition: false, NPopover: popover, Popover: popover } } });
    await flushPromises();
    await view.get('[data-testid="artifact-image-inline"]').trigger("load");
    await view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    const image = new DOMWrapper(document.querySelector<HTMLImageElement>('[data-testid="artifact-image-dialog-img"]')!);
    await image.trigger("load");
    const refresh = new DOMWrapper(document.querySelector<HTMLButtonElement>('[data-testid="artifact-image-refresh"]')!);
    const pending = deferred<{ status: "opened"; previewUrl: string }>();
    vi.mocked(client.openImagePreview).mockReturnValueOnce(pending.promise);
    await refresh.trigger("click"); await flushPromises();
    expect(document.activeElement).toBe(refresh.element);
    expect(refresh.attributes("aria-disabled")).toBe("true");
    expect(refresh.element.disabled).toBe(false);
    await refresh.trigger("click");
    expect(client.openImagePreview).toHaveBeenCalledTimes(3);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await flushPromises();
    expect(view.getComponent(NModal).props("show")).toBe(false);
    expect(document.activeElement).toBe(view.get('[data-testid="artifact-image-preview"]').element);
    pending.resolve({ status: "opened", previewUrl: URL_C }); await flushPromises();
    expect(view.getComponent(NModal).props("show")).toBe(false);
    view.unmount();
  });

  it("waits for a closed viewer's pending handle to release before reopening", async () => {
    const client = nativeClient(); const view = await readyWrapper(client);
    const pending = deferred<{ status: "opened"; previewUrl: string }>();
    vi.mocked(client.openImagePreview).mockReturnValueOnce(pending.promise);
    await view.get('[data-testid="artifact-image-inline"]').trigger("load");
    await view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    await view.get('[data-testid="artifact-image-close"]').trigger("click");
    await view.get('[data-testid="artifact-image-preview"]').trigger("click"); await flushPromises();
    expect(client.openImagePreview).toHaveBeenCalledTimes(2);
    pending.resolve({ status: "opened", previewUrl: URL_C }); await flushPromises();
    expect(client.openImagePreview).toHaveBeenCalledTimes(3);
    expect(client.releaseImagePreview).toHaveBeenCalledWith(CONTEXT_A, IDENTITY);
    expect(view.get('[data-testid="artifact-image-dialog-img"]').attributes("src")).toBe(URL_B);
    expect(vi.mocked(client.releaseImagePreview).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(client.openImagePreview).mock.invocationCallOrder[2]!);
  });

  it("keeps image and viewer accessible and respects reduced motion", async () => {
    const view = await readyWrapper(); await viewer(view);
    expect((await axe.run(view.element)).violations).toEqual([]);
    expect(readFileSync("src/components/chat/ChatArtifactImage.vue", "utf8")).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
