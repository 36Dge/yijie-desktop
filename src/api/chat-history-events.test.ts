import { describe, expect, it, vi } from "vitest";
import { onChatHistoryChanged } from "./chat-history-events";

const event = vi.hoisted(() => ({ handler: (() => {}) as (event: { payload: unknown }) => void, stop: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_channel, handler) => {
  event.handler = handler;
  return event.stop;
}) }));

describe("history invalidation", () => {
  it("accepts only the supported content-free event version", async () => {
    const changed = vi.fn();
    const stop = await onChatHistoryChanged(changed);
    event.handler({ payload: { schemaVersion: 2 } });
    event.handler({ payload: { schemaVersion: 1, extra: true } });
    expect(changed).not.toHaveBeenCalled();
    event.handler({ payload: { schemaVersion: 1 } });
    expect(changed).toHaveBeenCalledOnce();
    stop();
    expect(event.stop).toHaveBeenCalledOnce();
  });
});
