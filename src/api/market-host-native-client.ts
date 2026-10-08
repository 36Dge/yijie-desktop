import { invoke } from "@tauri-apps/api/core";
import * as validators from "./generated/market-host-native-validator.gen";
import * as selectionValidators from "./generated/market-selection-validator.gen";
import schema from "../../contracts/market-host-native.schema.json";
import type { Decision, ErrorCode, NativeApprovalDecidePayload, NativeObservation, MarketApproval } from "../domain/market-host-native.generated";
import type { SubmitPayload, SubmissionReceipt } from "../domain/market-selection.generated";

type Transport = (command: string, args: { request: unknown }) => Promise<unknown>;
type Schema = { $ref?: string; type?: string; properties?: Record<string, Schema>; items?: Schema; anyOf?: Schema[] };
const definitions = schema.$defs as unknown as Record<string, Schema>;
// Consume only fields from the generated authority. Future response properties
// are accepted by the wire validator but never spread into renderer state.
function project(definition: Schema, value: unknown): unknown {
  if (value === null) return null;
  if (definition.$ref) return project(definitions[definition.$ref.replace("#/$defs/", "")]!, value);
  if (definition.type === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(definition.properties ?? {}).filter(([key]) => Object.prototype.hasOwnProperty.call(source, key)).map(([key, child]) => [key, project(child, source[key])]));
  }
  if (definition.type === "array") return (value as unknown[]).map(item => project(definition.items ?? {}, item));
  return value;
}
export class MarketChatError extends Error {
  constructor(readonly code: ErrorCode, readonly outcomeUnknown = false) { super(code); this.name = "MarketChatError"; }
}
export function marketChatErrorMessage(error: unknown): string {
  const code = error instanceof MarketChatError ? error.code : "temporarily_unavailable";
  switch (code) {
    case "permission_mode_unavailable": return "连接器任务暂仅支持“请求批准”。请在权限菜单中手动切换后发送。";
    case "permission_denied": case "context_invalid": case "authority_mismatch": return "当前授权已变化，请刷新会话授权后重新核对。";
    case "approval_expired": case "approval_stale": case "approval_resolved": return "审批状态已变化，请刷新并查看当前结果。";
    case "selection_stale": return "连接器已变化，请重新选择。";
    case "execution_unavailable": case "not_qualified": return "连接器尚未就绪，请前往管理连接器检查授权和连接。";
    case "model_unavailable": return "模型尚未就绪，请检查模型设置。";
    case "operation_uncertain": return "操作结果待确认，请刷新核对原操作；不要重复提交。";
    case "session_not_found": return "当前会话已不可用，请返回会话列表。";
    default: return "暂时无法同步连接器状态，请刷新重试。";
  }
}
export function createMarketHostNativeClient(transport: Transport = invoke) {
  async function call(command: string, contextId: string, payload: unknown, mutation: boolean): Promise<unknown> {
    const requestId = crypto.randomUUID(); const request = { schemaVersion: 1, requestId, contextId, payload };
    const isObserve = command === "chat_market_observe_v1";
    const validateRequest = isObserve ? validators.validateNativeObserveRequest : validators.validateNativeApprovalDecideRequest;
    if (!validateRequest(request)) throw new MarketChatError("invalid_request");
    let response: unknown;
    try { response = await transport(command, { request }); }
    catch (error) {
      if (validators.validateNativeError(error) && error.requestId === requestId) throw new MarketChatError(error.code, error.code === "operation_uncertain");
      throw new MarketChatError(mutation ? "operation_uncertain" : "temporarily_unavailable", mutation);
    }
    const validate = isObserve ? validators.validateNativeObserveResponse : validators.validateNativeApprovalDecideResponse;
    if (!validate(response) || response.requestId !== requestId) throw new MarketChatError(mutation ? "operation_uncertain" : "not_ready", mutation);
    return project(definitions[isObserve ? "NativeObservation" : "MarketApproval"]!, response.data);
  }
  return {
    observe: (contextId: string, sessionId: string, nativeTurnId?: string) => call("chat_market_observe_v1", contextId, { sessionId, ...(nativeTurnId ? { nativeTurnId } : {}) }, false) as Promise<NativeObservation>,
    async decide(contextId: string, payload: NativeApprovalDecidePayload): Promise<MarketApproval> {
      const result = await call("chat_market_approval_decide_v1", contextId, payload, true) as MarketApproval;
      if (result.approvalId !== payload.approvalId || result.decisionId !== payload.decisionId || result.decision !== payload.decision) throw new MarketChatError("operation_uncertain", true);
      return result;
    },
    async submit(contextId: string, payload: SubmitPayload): Promise<SubmissionReceipt> {
      const requestId = crypto.randomUUID(); const request = { schemaVersion: 1, requestId, contextId, payload };
      if (!selectionValidators.validateSubmitRequest(request)) throw new MarketChatError("invalid_request");
      let response: unknown;
      try { response = await transport("chat_market_submit_v1", { request }); }
      catch (error) {
        if (selectionValidators.validateError(error) && error.requestId === requestId) throw new MarketChatError(error.code);
        throw new MarketChatError("operation_uncertain", true);
      }
      if (!selectionValidators.validateSubmitResponse(response) || response.requestId !== requestId || response.data.submissionOperationId !== payload.operationId || (payload.sessionId && response.data.sessionId !== payload.sessionId)) throw new MarketChatError("operation_uncertain", true);
      const r = response.data;
      return { outcome: r.outcome, sessionId: r.sessionId, localTurnId: r.localTurnId, submissionOperationId: r.submissionOperationId, turnOperationId: r.turnOperationId, selectionDigest: r.selectionDigest };
    },
  };
}
export const marketHostNativeClient = createMarketHostNativeClient();
export type MarketHostNativeClient = ReturnType<typeof createMarketHostNativeClient>;
export type { Decision };
