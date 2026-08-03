import { describe, expect, it } from "vitest";
import { isLocalChatUiEnabled } from "./chat-ui-config";

describe("local Chat UI config", () => {
  it("is default-off and accepts only the exact string true", () => {
    expect(isLocalChatUiEnabled("true")).toBe(true);
    for (const value of [undefined, null, "", "TRUE", "1", true, false]) {
      expect(isLocalChatUiEnabled(value)).toBe(false);
    }
  });
});
