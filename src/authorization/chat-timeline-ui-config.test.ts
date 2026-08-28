import { describe, expect, it } from "vitest";
import { isLegacyChatTimelineRollbackEnabled } from "./chat-timeline-ui-config";

describe("legacy Chat Timeline rollback config", () => {
  it("is default-off and accepts only the exact string true", () => {
    expect(isLegacyChatTimelineRollbackEnabled("true")).toBe(true);
    for (const value of [undefined, null, "", "TRUE", "1", true, false]) {
      expect(isLegacyChatTimelineRollbackEnabled(value)).toBe(false);
    }
  });
});
