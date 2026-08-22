import { describe, expect, it, vi } from "vitest";
import {
  createChatArtifactLiveClient,
  type ChatArtifactLiveListen,
} from "./chat-artifact-live-client";

const changed = {
  schemaVersion: 1,
  subscriptionId: "018f0000-0000-7000-8000-000000000001",
  contextId: "018f0000-0000-7000-8000-000000000002",
  sessionId: "018f0000-0000-7000-8000-000000000003",
  turnId: "018f0000-0000-7000-8000-000000000004",
  eventId: "018f0000-0000-7000-8000-000000000005",
  notificationSequence: "1",
  kind: "artifact_changed",
  payload: {},
} as const;

describe("ChatArtifactLiveClient", () => {
  it("listens only on the exact private channel and returns unlisten", async () => {
    const unlisten: () => void = vi.fn();
    const received = vi.fn();
    const listen: ChatArtifactLiveListen = vi.fn(async (channel, handler) => {
      expect(channel).toBe("yijie:chat:artifact:changed:v1");
      handler(changed);
      return unlisten;
    });
    const client = createChatArtifactLiveClient(listen);
    await expect(client.listen(received)).resolves.toBe(unlisten);
    expect(received).toHaveBeenCalledWith(changed);
  });

  it("drops invalid native payloads through the content-free invalid callback", async () => {
    const onEvent = vi.fn();
    const onInvalid = vi.fn();
    const unlisten: () => void = vi.fn();
    const listen: ChatArtifactLiveListen = async (_channel, handler) => {
      handler({ ...changed, payload: { path: "/Users/example/secret" } });
      return unlisten;
    };
    await createChatArtifactLiveClient(listen).listen(onEvent, onInvalid);
    expect(onEvent).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onInvalid.mock.calls)).not.toContain("/Users/example/secret");
  });
});
