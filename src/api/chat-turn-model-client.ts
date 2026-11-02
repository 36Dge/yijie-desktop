import { invoke } from "@tauri-apps/api/core";
import { validateTurnModelView } from "./generated/chat-turn-model-validator.gen.js";
import type { TurnModelView } from "../domain/chat-turn-model.generated";

type Invoker = (command: string, args: Record<string, unknown>) => Promise<unknown>;
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new Error("read_cancelled")); };
    signal.addEventListener("abort", abort, {once:true});
    work.then(value => {cleanup(); resolve(value);}, error => {cleanup(); reject(error);});
    if (signal.aborted) abort();
  });
}
export function createTurnModelClient(nativeInvoke: Invoker = invoke) {
  return async (contextId: string, sessionId: string, turnId: string, signal?: AbortSignal): Promise<TurnModelView> => {
    if (signal?.aborted) throw new Error("read_cancelled");
    const requestId = crypto.randomUUID();
    const result = await abortable(nativeInvoke("chat_read_turn_model_v1", {request: {schemaVersion: 1, requestId, contextId, payload: {sessionId, turnId}}}), signal);
    if (signal?.aborted) throw new Error("read_cancelled");
    if (!result || typeof result !== "object" || !("schemaVersion" in result) || result.schemaVersion !== 1 ||
      !("requestId" in result) || result.requestId !== requestId || !("data" in result) ||
      !validateTurnModelView(result.data) || result.data.sessionId !== sessionId || result.data.turnId !== turnId) {
      throw new Error("turn_model_unavailable");
    }
    return result.data;
  };
}
export const readTurnModel = createTurnModelClient();
