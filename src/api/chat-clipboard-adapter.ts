export const CHAT_CLIPBOARD_WRITE_FAILED = "clipboard_write_failed";

export type ChatClipboardWriter = (text: string) => Promise<void>;

export interface ChatClipboardAdapter {
  writeText(text: string): Promise<void>;
}

export function createChatClipboardAdapter(
  writer: ChatClipboardWriter,
): ChatClipboardAdapter {
  return Object.freeze({
    async writeText(text: string): Promise<void> {
      try {
        await writer(text);
      } catch {
        throw new Error(CHAT_CLIPBOARD_WRITE_FAILED);
      }
    },
  });
}

async function writeBrowserClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function") {
    throw new Error(CHAT_CLIPBOARD_WRITE_FAILED);
  }
  await clipboard.writeText(text);
}

export const browserChatClipboardAdapter = createChatClipboardAdapter(
  writeBrowserClipboard,
);
