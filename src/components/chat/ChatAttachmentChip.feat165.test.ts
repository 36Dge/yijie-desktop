// @vitest-environment happy-dom
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import ChatAttachmentChip from "./ChatAttachmentChip.vue";
import type { AttachmentPresentation } from "../../domain/chat-file-presentation";

enableAutoUnmount(afterEach);
const popover = defineComponent({ props: ["show"], template: '<div><slot name="trigger"/><div v-if="show"><slot/></div></div>' });
const base = { attachmentId: "file-1", name: "普通文件.jpeg", mediaType: "image/jpeg", status: "ready", removable: true };
function chip(props = {}) { return mount(ChatAttachmentChip, { props: {...base, ...props}, global: {stubs: {NPopover: popover, Popover: popover}} }); }
describe("FEAT165 local attachment chip", () => {
  it("FEAT166 opens only explicitly bound non-media references on click or keyboard", async () => {
    const openPreview=vi.fn();
    const view=chip({name:"normal.pdf",mediaType:"application/pdf",status:"bound",removable:false,openPreview});
    const trigger=view.get(".chat-file-chip");
    expect(trigger.attributes("role")).toBe("button");
    await trigger.trigger("click");await trigger.trigger("keydown",{key:"Enter"});await trigger.trigger("keydown",{key:" "});
    expect(openPreview).toHaveBeenCalledTimes(3);
    expect(view.find(".chat-file-chip__remove").exists()).toBe(false);
  });
  it("loads an image only on demand and discards a reply after closing", async () => {
    let complete!: (value: AttachmentPresentation) => void;
    const read = vi.fn(() => new Promise<AttachmentPresentation>(resolve => {complete = resolve;}));
    const view = chip({readPresentation: read});
    expect(read).not.toHaveBeenCalled();
    await view.setProps({active: true});
    expect(view.text()).toContain("正在加载图片");
    await view.setProps({active: false});
    complete({sourcePath: "/ordinary/sample.jpeg", imageUrl: "data:image/png;base64,AA==", expiresAt: Date.now()/1000 + 30});
    await flushPromises();
    expect(view.find("img").exists()).toBe(false);
    expect(view.text()).not.toContain("/ordinary/");
  });
  it("never replaces a failed image preview with a path tooltip", async () => {
    const view = chip({active: true, readPresentation: async () => {throw new Error("unavailable");}});
    await flushPromises();
    expect(view.text()).toContain("暂时无法预览");
    expect(view.text()).not.toContain("来源路径");
    await view.get('[aria-label="移除 普通文件.jpeg"]').trigger("click");
    expect(view.emitted("remove")).toEqual([["file-1"]]);
  });
  it("shows only the current non-image path, keeps the extension, and supports Esc", async () => {
    const view = chip({name: "很长的普通文件.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", active: true, readPresentation: async () => ({sourcePath: "/ordinary/很长的普通文件.docx", imageUrl: null, expiresAt: Date.now()/1000 + 30})});
    await flushPromises();
    expect(view.get(".chat-file-chip__extension").text()).toBe(".docx");
    expect(view.text()).toContain("/ordinary/很长的普通文件.docx");
    await view.get(".chat-file-chip").trigger("keydown", {key: "Escape"});
    expect(view.emitted("activate")).toContainEqual([null]);
    await view.setProps({active: false});
    expect(view.text()).not.toContain("/ordinary/");
  });
  it("renders sent metadata with no reader, path or removable action", () => {
    const view = chip({status: "bound", removable: false});
    expect(view.find("button").exists()).toBe(false);
    expect(view.get(".chat-file-chip").attributes("tabindex")).toBeUndefined();
    expect(view.text()).toBe("普通文件.jpeg");
  });
  it("reopens with Enter after Esc without moving focus", async () => {
    const read = vi.fn(async () => ({sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: Date.now()/1000 + 30}));
    const view = chip({active: true, readPresentation: read});
    await flushPromises();
    const trigger = view.get(".chat-file-chip");
    await trigger.trigger("keydown", {key: "Escape"});
    await view.setProps({active: false});
    await trigger.trigger("keydown", {key: "Enter"});
    expect(view.emitted("activate")?.slice(-1)).toEqual([["file-1"]]);
    await view.setProps({active: true});
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.find("img").exists()).toBe(true);
  });
  it("keeps an image error open while keyboard focus enters retry and closes when focus leaves", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue({sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: Date.now()/1000 + 30});
    const view = chip({active: true, readPresentation: read});
    await flushPromises();
    const retry = view.get(".chat-file-chip__retry");
    await view.get(".chat-file-chip").trigger("blur", {relatedTarget: retry.element});
    await view.get(".chat-file-chip").trigger("focusout", {relatedTarget: retry.element});
    expect(view.emitted("activate")).toBeUndefined();
    await retry.trigger("click");
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(2);
    expect(view.find("img").exists()).toBe(true);
    await view.get(".chat-file-chip__popover").trigger("focusout", {relatedTarget: document.createElement("button")});
    expect(view.emitted("activate")?.slice(-1)).toEqual([[null]]);
  });
});
