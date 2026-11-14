// @vitest-environment happy-dom
import { mount, flushPromises, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { chatClient } from "../api/chat-client";
import { useChatAttachmentPresentation } from "./useChatAttachmentPresentation";
import type { AttachmentPresentationReader, AttachmentPresentation } from "../domain/chat-file-presentation";
import type { ChatDraftTarget } from "../domain/chat-ipc";

vi.mock("../api/chat-client", () => ({ chatClient: { attachmentPresentation: vi.fn() } }));
enableAutoUnmount(afterEach);
beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.useRealTimers());
describe("attachment presentation queue", () => {
  it("reuses a bound thumbnail across conversations until its original native expiry", async () => {
    vi.useFakeTimers();
    const target = ref<ChatDraftTarget>({ type: "session", sessionId: "session-a" });
    const visible = ref(true), authorized = ref(true);
    let reader!: AttachmentPresentationReader;
    const read = vi.mocked(chatClient.attachmentPresentation).mockImplementation(async (_context, selected) => ({
      sourcePath: null, imageUrl: `data:image/png;base64,${selected.type === "session" ? selected.sessionId : ""}`,
      expiresAt: Date.now() / 1000 + 30,
    }));
    mount(defineComponent({ setup() {
      reader = useChatAttachmentPresentation(() => "context-a", () => target.value, () => ["same-id"], () => visible.value, "bound", () => authorized.value);
      return () => null;
    } }));
    const first = await reader("same-id");
    visible.value = false;
    target.value = { type: "session", sessionId: "session-b" };
    await flushPromises();
    visible.value = true;
    const second = await reader("same-id");
    expect(second.imageUrl).not.toBe(first.imageUrl);
    target.value = { type: "session", sessionId: "session-a" };
    await flushPromises();
    expect(await reader("same-id")).toEqual(first);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30001);
    await reader("same-id");
    expect(read).toHaveBeenCalledTimes(3);
    authorized.value = false;
    await flushPromises();
    authorized.value = true;
    await reader("same-id");
    expect(read).toHaveBeenCalledTimes(4);
  });
  it("preserves draft origins across same-owner lease renewal and temporary composer busy states", async () => {
    const lease = ref({ contextId: "context-a", expiresAt: 1000 });
    const target = ref<ChatDraftTarget>({ type: "session", sessionId: "session-a" });
    const allowed = ref(true);
    let sourcePath: string | null = "/ordinary/notes.md";
    vi.mocked(chatClient.attachmentPresentation).mockImplementation(async (_context, _draft, _attachment, action) => {
      if (action === "clear") sourcePath = null;
      return { sourcePath, imageUrl: null, expiresAt: 2_000_000_000 };
    });
    let reader!: AttachmentPresentationReader;
    mount(defineComponent({ setup() { reader = useChatAttachmentPresentation(() => lease.value.contextId, () => target.value, () => ["doc"], () => allowed.value); return () => null; } }));
    expect((await reader("doc")).sourcePath).toBe(sourcePath);
    lease.value = { contextId: "context-a", expiresAt: 1300 };
    target.value = { sessionId: "session-a", type: "session" };
    await flushPromises();
    allowed.value = false;
    await flushPromises();
    await expect(reader("doc")).rejects.toThrow("attachment_unavailable");
    allowed.value = true;
    await flushPromises();
    expect((await reader("doc")).sourcePath).toBe("/ordinary/notes.md");
    expect(vi.mocked(chatClient.attachmentPresentation).mock.calls.some(call => call[3] === "clear")).toBe(false);
    target.value = { type: "session", sessionId: "session-b" };
    await flushPromises();
    expect(chatClient.attachmentPresentation).toHaveBeenLastCalledWith("context-a", { type: "session", sessionId: "session-a" }, null, "clear");
  });
  it("bounds retained history thumbnails and drops removed attachments", async () => {
    const ids = ref(Array.from({ length: 25 }, (_, index) => `image-${index}`));
    let reader!: AttachmentPresentationReader;
    vi.mocked(chatClient.attachmentPresentation).mockImplementation(async () => ({ sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: Date.now() / 1000 + 30 }));
    const view = mount(defineComponent({ setup() {
      reader = useChatAttachmentPresentation(() => "context-a", () => ({ type: "session", sessionId: "session-a" }), () => ids.value, () => true, "bound");
      return () => null;
    } }));
    for (const id of ids.value) await reader(id);
    expect(reader.peek?.("image-0")).toBeNull();
    expect(reader.peek?.("image-24")).not.toBeNull();
    ids.value = ids.value.filter(id => id !== "image-24");
    await flushPromises();
    ids.value.push("image-24");
    expect(reader.peek?.("image-24")).toBeNull();
    view.unmount();
    expect(reader.peek?.("image-23")).toBeNull();
  });
  it("does not restore an old in-flight thumbnail after authority is revoked and restored", async () => {
    const allowed = ref(true);
    let reader!: AttachmentPresentationReader;
    mount(defineComponent({ setup() {
      reader = useChatAttachmentPresentation(() => "context-a", () => ({ type: "session", sessionId: "session-a" }), () => ["a"], () => allowed.value, "bound");
      return () => null;
    } }));
    let complete!: (value: AttachmentPresentation) => void;
    vi.mocked(chatClient.attachmentPresentation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = reader("a").catch(error => error);
    await flushPromises();
    allowed.value = false; allowed.value = true;
    complete({ sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: Date.now() / 1000 + 30 });
    expect(await pending).toBeInstanceOf(Error);
    expect(reader.peek?.("a")).toBeNull();
  });
  it("serializes bound image reads and skips a thumbnail removed before its read starts", async () => {
    const context = ref("context-a");
    const target = { type: "session" as const, sessionId: "session-a" };
    let reader!: AttachmentPresentationReader;
    mount(defineComponent({ setup() { reader = useChatAttachmentPresentation(() => context.value, () => target, () => ["a", "b"], () => true, "bound"); return () => null; } }));
    let complete!: (value: AttachmentPresentation) => void;
    vi.mocked(chatClient.attachmentPresentation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = reader("a");
    const cancelled = new AbortController();
    const second = reader("b", cancelled.signal).catch(error => error);
    await flushPromises();
    expect(chatClient.attachmentPresentation).toHaveBeenCalledTimes(1);
    expect(chatClient.attachmentPresentation).toHaveBeenCalledWith("context-a", target, "a", "read_bound");
    cancelled.abort();
    complete({ sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: 2_000_000_000 });
    await first;
    expect(await second).toBeInstanceOf(Error);
    expect(chatClient.attachmentPresentation).toHaveBeenCalledTimes(1);
  });
  it("discards a read from a previous session context", async () => {
    const context = ref("context-a");
    const target = { type: "session" as const, sessionId: "session-a" };
    let reader!: AttachmentPresentationReader;
    mount(defineComponent({ setup() { reader = useChatAttachmentPresentation(() => context.value, () => target, () => ["a"], () => true, "bound"); return () => null; } }));
    let complete!: (value: AttachmentPresentation) => void;
    vi.mocked(chatClient.attachmentPresentation).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = reader("a").catch(error => error);
    await flushPromises();
    context.value = "context-b";
    await flushPromises();
    complete({ sourcePath: null, imageUrl: "data:image/png;base64,AA==", expiresAt: 2_000_000_000 });
    expect(await pending).toBeInstanceOf(Error);
    expect(chatClient.attachmentPresentation).toHaveBeenCalledTimes(1);
  });
});
