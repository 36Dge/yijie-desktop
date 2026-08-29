import { describe, expect, it, vi } from "vitest";
import { createChatClient, type ChatClientTransport } from "./chat-client";
import { CHAT_EVENT_CHANNEL } from "../domain/chat-ipc";

const REQUEST_ID = "13410000-0000-4000-8000-000000000001";
const CONTEXT_ID = "13410000-0000-4000-8000-000000000002";
const SESSION_ID = "13410000-0000-4000-8000-000000000003";
const PROJECT_ID = "13410000-0000-4000-8000-000000000004";
const SUBSCRIPTION_ID = "13410000-0000-4000-8000-000000000005";
const TURN_ID = "13410000-0000-4000-8000-000000000006";
const EVENT_ID = "13410000-0000-4000-8000-000000000007";
const SOURCE_EVENT_ID = "13410000-0000-4000-8000-000000000008";

function transport(invoke: ChatClientTransport["invoke"]): ChatClientTransport {
  return { invoke, listen: async () => () => undefined };
}

function history() {
  return { turns: [], nextCursor: null, sessionNotices: [], durableSequenceCut: "0" };
}

describe("FEAT-134 chat client v4", () => {
  it("negotiates v4 over the existing private commands", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => REQUEST_ID });
    const nativeInvoke = vi.fn(async (
      command: string,
      arguments_?: Record<string, unknown>,
    ) => {
      void arguments_;
      const data = command === "chat_subscribe_session_v1"
        ? { subscriptionId: SUBSCRIPTION_ID }
        : command === "chat_load_history_v3"
          ? history()
          : {
              session: {
                sessionId: SESSION_ID,
                projectId: PROJECT_ID,
                title: "Synthetic session",
                titleSource: "fallback",
                pinnedAt: null,
                lastActivityAt: 1,
                latestTurnStatus: null,
                projectAvailable: true,
              },
              history: history(),
              cleanup: null,
            };
      return { schemaVersion: 4, requestId: REQUEST_ID, data };
    });
    const client = createChatClient(transport(nativeInvoke));

    await expect(client.subscribeSessionV4(CONTEXT_ID, SESSION_ID)).resolves
      .toBe(SUBSCRIPTION_ID);
    await expect(client.loadHistoryV4(CONTEXT_ID, SESSION_ID, undefined, 20)).resolves
      .toMatchObject({ sessionNotices: [] });
    await expect(client.resyncSessionV4(CONTEXT_ID, SESSION_ID, 20)).resolves
      .toMatchObject({ history: { sessionNotices: [] } });

    expect(nativeInvoke.mock.calls.map(([command]) => command)).toEqual([
      "chat_subscribe_session_v1",
      "chat_load_history_v3",
      "chat_resync_session_v2",
    ]);
    for (const [, arguments_] of nativeInvoke.mock.calls) {
      expect(arguments_).toMatchObject({ request: { schemaVersion: 4 } });
    }
  });

  it("accepts only closed v4 events on the shared event channel", async () => {
    let receive!: (payload: unknown) => void;
    const handler = vi.fn();
    const invalid = vi.fn();
    const listen = vi.fn(async (_channel: string, callback: (payload: unknown) => void) => {
      receive = callback;
      return () => undefined;
    });
    const client = createChatClient({ invoke: async () => undefined, listen });
    await client.onEventV4(handler, invalid);

    const valid = {
      schemaVersion: 4,
      subscriptionId: SUBSCRIPTION_ID,
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      projectionSequence: "1",
      eventId: EVENT_ID,
      durableSequence: "1",
      kind: "turn_started",
      payload: {
        sourceEventId: SOURCE_EVENT_ID,
        sourceSequence: "1",
        sourceOccurredAt: "2026-08-28T06:00:00Z",
      },
    };
    receive(valid);
    receive({ ...valid, payload: { ...valid.payload, body: "private" } });

    expect(listen).toHaveBeenCalledWith(CHAT_EVENT_CHANNEL, expect.any(Function));
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(valid);
    expect(invalid).toHaveBeenCalledWith({
      contextId: CONTEXT_ID,
      sessionId: SESSION_ID,
      subscriptionId: SUBSCRIPTION_ID,
    });
  });
});
