import {describe, it, expect, vi} from "vitest";
import {createWebSourceClient} from "./chat-web-source-client";
const target = {sessionId:"00000000-0000-4000-8000-000000000001", turnId:"00000000-0000-4000-8000-000000000002",itemId:"search",url:"https://example.org/guide"};
describe("versioned web source client", () => {
  it("uses the additive message-link action with the original message identity", async () => {
    const invoke = vi.fn(async (_command, args) => ({schemaVersion:1,requestId:args.request.requestId,data:{status:"opened",icon:null}}));
    expect(await createWebSourceClient(invoke)("context", {action:"open_message_link",target})).toEqual({status:"opened",icon:null});
    expect(invoke.mock.calls[0]![1].request.payload).toEqual({action:"open_message_link",target});
  });
  it("uses the current context and verifies response identity and action", async () => {
    const invoke = vi.fn(async (_command, args) => ({schemaVersion:1,requestId:args.request.requestId,data:{status:"opened",icon:null}}));
    const client = createWebSourceClient(invoke);
    expect(await client("context",{action:"open",target})).toEqual({status:"opened",icon:null});
    expect(invoke.mock.calls[0]![0]).toBe("chat_web_source_v1");
    expect(invoke.mock.calls[0]![1].request.contextId).toBe("context");
    await expect(client("context",{action:"icon",target})).rejects.toThrow("web_source_unavailable");
  });
  it("accepts a missing site icon and rejects an incompatible response version", async () => {
    const client = createWebSourceClient(async (_command,args) => ({schemaVersion:1,requestId:(args.request as {requestId:string}).requestId,data:{status:"unavailable",icon:null}}));
    expect((await client("context",{action:"icon",target})).icon).toBeNull();
    const incompatible = createWebSourceClient(async () => ({schemaVersion:2,data:{status:"opened",icon:null}}));
    await expect(incompatible("context",{action:"open",target})).rejects.toThrow("web_source_unavailable");
  });
});
