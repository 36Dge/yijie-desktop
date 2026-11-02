import { describe, expect, it, vi } from "vitest";
import { createTurnModelClient } from "./chat-turn-model-client";
const sessionId="00000000-0000-4000-8000-000000000001", turnId="00000000-0000-4000-8000-000000000002";
describe("read-only turn model client", () => {
  it("requests one exact turn and validates its model snapshot response", async () => {
    const invoke=vi.fn(async (_command,args)=>({schemaVersion:1,requestId:args.request.requestId,data:{sessionId,turnId,profileId:"kimi-k3-1-pro-max-v1"}}));
    const data=await createTurnModelClient(invoke)("context",sessionId,turnId);
    expect(data.profileId).toBe("kimi-k3-1-pro-max-v1");
    expect(invoke.mock.calls[0]![0]).toBe("chat_read_turn_model_v1");
    expect(invoke.mock.calls[0]![1].request.payload).toEqual({sessionId,turnId});
  });
  it("keeps missing historical data unknown and rejects a mismatched reply", async () => {
    const read=createTurnModelClient(async (_command,args)=>({schemaVersion:1,requestId:(args.request as {requestId:string}).requestId,data:{sessionId,turnId,profileId:null}}));
    expect((await read("context",sessionId,turnId)).profileId).toBeNull();
    await expect(createTurnModelClient(async()=>({schemaVersion:1,requestId:"another",data:{sessionId,turnId,profileId:null}}))("context",sessionId,turnId)).rejects.toThrow("turn_model_unavailable");
  });
  it("releases a cancelled optional read without waiting for its late response", async () => {
    const controller=new AbortController(); let finish!: (value: unknown)=>void;
    const read=createTurnModelClient(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=read("context",sessionId,turnId,controller.signal);
    const check=expect(pending).rejects.toThrow("read_cancelled"); controller.abort(); await check; finish(null);
  });
});
