import { invoke } from "@tauri-apps/api/core";
import { ChatClientError, parseChatIpcError } from "../domain/chat-ipc";
import type { components } from "./generated/user-input.gen";
import { validateUserInputRequest, validateUserInputSnapshot, validateUserInputAnswerRequest } from "./generated/user-input-validator.gen.js";
export type UserInputRequest = components["schemas"]["UserInputRequest"];
export type UserInputSnapshot = components["schemas"]["UserInputSnapshot"];
export type UserInputAnswer = components["schemas"]["UserInputAnswerRequest"];
export type UserInputAnswers = UserInputAnswer["answers"];
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("问答状态暂不可用。");
  return v as Record<string, unknown>;
}
async function call(command: string, contextId: string, payload: Record<string, unknown>): Promise<unknown> {
  const requestId = crypto.randomUUID();
  try {
    const v = record(await invoke(command, { request: { schemaVersion: 1, requestId, contextId, payload } }));
    if (v.schemaVersion !== 1 || v.requestId !== requestId) throw new Error();
    return v.data;
  } catch (failure: unknown) {
    // Only a valid error for this exact IPC request can prove absence. Reuse
    // the existing Native error envelope and keep arbitrary failures uncertain.
    const protocolError = () => new ChatClientError({ schemaVersion: 1, requestId, code: "chat_protocol_error", retryable: false, recovery: "resync" });
    let error;
    try { error = parseChatIpcError(failure); }
    catch { throw protocolError(); }
    if (error.schemaVersion !== 1 || error.requestId !== requestId) throw protocolError();
    throw new ChatClientError(error);
  }
}
function request(v: unknown, id: string): UserInputRequest {
  if (!validateUserInputRequest(v) || record(v).request_id !== id) throw new Error("问答响应不匹配。");
  return v as UserInputRequest;
}
export const userInputClient = {
  async snapshot(contextId: string, sessionId: string): Promise<UserInputSnapshot> {
    const v = await call("chat_user_input_snapshot_v1", contextId, { sessionId });
    if (!validateUserInputSnapshot(v)) throw new Error("问答状态暂不可用。");
    return v as UserInputSnapshot;
  },
  async read(contextId: string, sessionId: string, id: string): Promise<UserInputRequest> {
    return request(await call("chat_user_input_read_v1", contextId, { sessionId, inputRequestId: id }), id);
  },
  async touch(contextId: string, sessionId: string, id: string): Promise<UserInputRequest> {
    return request(await call("chat_user_input_touch_v1", contextId, { sessionId, inputRequestId: id }), id);
  },
  async answer(contextId: string, sessionId: string, id: string, answer: UserInputAnswer): Promise<UserInputRequest> {
    if (!validateUserInputAnswerRequest(answer)) throw new Error("请检查回答内容。");
    return request(await call("chat_user_input_answer_v1", contextId, { sessionId, inputRequestId: id, answer }), id);
  },
};
