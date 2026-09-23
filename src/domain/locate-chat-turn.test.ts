import { expect, it, vi } from "vitest";
import { locateChatTurn } from "./locate-chat-turn";
it("loads bounded older history and never substitutes the latest turn", async () => {
  let page = 0;
  const loadOlder = vi.fn(async () => { page++; });
  expect(await locateChatTurn({ current: () => true, found: () => page === 3, cursor: () => String(page), loadOlder })).toBe("found");
  expect(loadOlder).toHaveBeenCalledTimes(3);
  page = 0; loadOlder.mockClear();
  expect(await locateChatTurn({ current: () => true, found: () => false, cursor: () => String(page), loadOlder }, 2)).toBe("more");
  expect(loadOlder).toHaveBeenCalledTimes(2);
});
it("stops on unchanged cursor, missing history or scope/navigation change", async () => {
  const loadOlder = vi.fn(async () => undefined);
  expect(await locateChatTurn({ current: () => true, found: () => false, cursor: () => "same", loadOlder })).toBe("unavailable");
  expect(loadOlder).toHaveBeenCalledOnce();
  expect(await locateChatTurn({ current: () => false, found: () => true, cursor: () => "next", loadOlder })).toBe("superseded");
});
