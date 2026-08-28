import { describe, expect, it, vi } from "vitest";
import {
  CHAT_CLIPBOARD_WRITE_FAILED,
  createChatClipboardAdapter,
} from "./chat-clipboard-adapter";

describe("chat clipboard adapter", () => {
  it("writes the exact text once without trimming or rewriting it", async () => {
    const writer = vi.fn<(_: string) => Promise<void>>().mockResolvedValue();
    const adapter = createChatClipboardAdapter(writer);
    const text = "  first line\nsecond line  ";

    await expect(adapter.writeText(text)).resolves.toBeUndefined();

    expect(writer).toHaveBeenCalledOnce();
    expect(writer).toHaveBeenCalledWith(text);
    expect(Object.isFrozen(adapter)).toBe(true);
    expect(Object.keys(adapter)).toEqual(["writeText"]);
  });

  it("closes rejected writers to one stable error without leaking their reason", async () => {
    const writer = vi.fn<(_: string) => Promise<void>>()
      .mockRejectedValue(new Error("private host detail /private/example"));
    const adapter = createChatClipboardAdapter(writer);

    const error = await adapter.writeText("safe text").catch((reason: unknown) => reason);

    expect(writer).toHaveBeenCalledOnce();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(CHAT_CLIPBOARD_WRITE_FAILED);
    expect((error as Error).message).not.toContain("private host detail");
  });
});
