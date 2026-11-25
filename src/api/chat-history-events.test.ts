import { describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { onChatHistoryChanged, onScheduledRunCreated } from "./chat-history-events";

const event = vi.hoisted(() => ({ handler: (() => {}) as (event: { payload: unknown }) => void, stop: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_channel, handler) => {
  event.handler = handler;
  return event.stop;
}) }));

describe("history invalidation", () => {
  it.each([
    ["yijie://chat-history-changed-v1", onChatHistoryChanged],
    ["yijie://scheduled-run-created-v1", onScheduledRunCreated],
  ] as const)("accepts only the supported content-free event version on %s", async (channel, subscribe) => {
    const changed = vi.fn();
    event.stop.mockClear();
    const stop = await subscribe(changed);
    expect(listen).toHaveBeenCalledWith(channel, expect.any(Function));
    event.handler({ payload: { schemaVersion: 2 } });
    event.handler({ payload: { schemaVersion: 1, extra: true } });
    expect(changed).not.toHaveBeenCalled();
    event.handler({ payload: { schemaVersion: 1 } });
    expect(changed).toHaveBeenCalledOnce();
    stop();
    expect(event.stop).toHaveBeenCalledOnce();
  });
});
