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
describe("attachment presentation queue", () => {
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
