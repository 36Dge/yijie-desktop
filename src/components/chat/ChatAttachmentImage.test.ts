// @vitest-environment happy-dom
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ChatAttachmentImage from "./ChatAttachmentImage.vue";
import type { AttachmentPresentation } from "../../domain/chat-file-presentation";

enableAutoUnmount(afterEach);
beforeEach(() => vi.stubGlobal("IntersectionObserver", undefined));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const popover = defineComponent({ props: ["show"], template: '<div><slot name="trigger"/><div v-if="show"><slot/></div></div>' });
const imageUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const result = (): AttachmentPresentation => ({ sourcePath: "/ordinary/photo.png", imageUrl, expiresAt: Date.now() / 1000 + 30 });
function image(props = {}) {
  return mount(ChatAttachmentImage, { props: { attachmentId: "image-1", name: "photo.png", status: "ready", readPresentation: async () => result(), ...props }, global: { stubs: { NPopover: popover, Popover: popover } } });
}
function observeViewport() {
  let update!: (visible: boolean) => void;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) {
      update = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe() {}
    disconnect() {}
  });
  return (visible: boolean) => update(visible);
}
describe("input image presentation", () => {
  it("renders a retained history thumbnail on the first render without another read", () => {
    const value = result();
    const read = Object.assign(vi.fn(async () => value), { peek: vi.fn(() => value) });
    const view = image({ status: "bound", readPresentation: read });
    expect(view.get("img").attributes("src")).toBe(imageUrl);
    expect(view.find(".chat-attachment-image__placeholder").exists()).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("ignores an old image error after its history component unmounts", async () => {
    const value = result();
    const read = Object.assign(vi.fn(async () => value), { peek: () => value, invalidate: vi.fn() });
    const view = image({ status: "bound", readPresentation: read });
    const old = view.get("img").element;
    view.unmount();
    old.dispatchEvent(new Event("error"));
    await flushPromises();
    expect(read.invalidate).not.toHaveBeenCalled();
  });
  it("keeps the same decoded thumbnail when scrolling out and back within its lease", async () => {
    const visible = observeViewport();
    const read = vi.fn(async () => result());
    const view = image({ readPresentation: read });
    expect(read).not.toHaveBeenCalled();
    visible(true);
    await flushPromises();
    const thumbnail = view.get("img").element;
    await view.get(".chat-attachment-image__thumbnail").trigger("focus");
    visible(false);
    await flushPromises();
    expect(view.find(".chat-attachment-image__preview").exists()).toBe(false);
    expect(view.get("img").element).toBe(thumbnail);
    visible(true);
    await flushPromises();
    expect(view.get("img").element).toBe(thumbnail);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("lets an authorized in-flight image finish after scrolling away instead of decoding it again", async () => {
    const visible = observeViewport();
    let complete!: (value: AttachmentPresentation) => void;
    const read = vi.fn(() => new Promise<AttachmentPresentation>(resolve => { complete = resolve; }));
    const view = image({ readPresentation: read });
    visible(true);
    await flushPromises();
    visible(false);
    await flushPromises();
    complete(result());
    await flushPromises();
    visible(true);
    await flushPromises();
    expect(view.get("img").attributes("src")).toBe(imageUrl);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("expires offscreen images without background reads and releases them when the scope changes", async () => {
    vi.useFakeTimers();
    const visible = observeViewport();
    const read = vi.fn(async () => result());
    const view = image({ readPresentation: read, scopeKey: "session-a" });
    visible(true);
    await flushPromises();
    visible(false);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30000);
    expect(view.find("img").exists()).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    visible(true);
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
    visible(false);
    await flushPromises();
    await view.setProps({ scopeKey: "session-b" });
    expect(view.find("img").exists()).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("shows the thumbnail immediately, previews on focus, closes with Escape and reopens with click", async () => {
    const read = vi.fn(async () => result());
    const view = image({ readPresentation: read, removable: true });
    await flushPromises();
    expect(view.findAll("img")).toHaveLength(1);
    expect(view.text()).not.toContain("photo.png");
    expect(view.html()).not.toContain("/ordinary/");
    const trigger = view.get(".chat-attachment-image__thumbnail");
    await trigger.trigger("focus");
    expect(view.findAll("img")).toHaveLength(2);
    await trigger.trigger("keydown", { key: "Escape" });
    expect(view.findAll("img")).toHaveLength(1);
    await trigger.trigger("click");
    expect(view.findAll("img")).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(1);
    await view.get('[aria-label="移除 photo.png"]').trigger("click");
    expect(view.emitted("remove")).toEqual([["image-1"]]);
  });
  it("discards an in-flight preview when its context is disabled", async () => {
    let complete!: (value: AttachmentPresentation) => void;
    const view = image({ readPresentation: () => new Promise<AttachmentPresentation>(resolve => { complete = resolve; }) });
    await view.setProps({ disabled: true });
    complete(result());
    await flushPromises();
    expect(view.find("img").exists()).toBe(false);
    expect(view.get(".chat-attachment-image__thumbnail").attributes("disabled")).toBeDefined();
  });
  it("keeps a failed preview removable and retryable without a source path", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(result());
    const view = image({ readPresentation: read, removable: true });
    await flushPromises();
    expect(view.text()).toContain("暂时无法预览");
    await view.get(".chat-attachment-image__thumbnail").trigger("click");
    await flushPromises();
    expect(view.get("img").attributes("src")).toBe(imageUrl);
    expect(view.html()).not.toContain("/ordinary/");
  });
  it("renews a visible short-lived bound image and releases it on expiry or unmount", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => result());
    const view = image({ status: "bound", readPresentation: read });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(30000);
    expect(read).toHaveBeenCalledTimes(2);
    await view.setProps({ status: "expired" });
    expect(view.find("img").exists()).toBe(false);
    expect(view.text()).toContain("图片已过期");
    view.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
