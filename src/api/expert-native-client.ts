import { invoke } from "@tauri-apps/api/core";
import { EXPERT_COMMANDS, type BindingReadResponse, type BindingSetResponse, type BindingSetPayload, type CatalogSnapshot, type DeveloperInfo, type ErrorCode, type ExpertSelection, type NativeSubmitPayload, type NativeSubmitResponse, type ResourceOperation, type SnapshotResponse, type PrepareResponse } from "../domain/experts.generated";
import * as validators from "./generated/experts-validator.gen";
import { expertSelection } from "../domain/expert-ui";

type Command = typeof EXPERT_COMMANDS[number]["command"];
type Validator = (value: unknown) => boolean;
type Envelope<T> = { schemaVersion: 1; requestId: string; data: T };

export class ExpertClientError extends Error {
  constructor(readonly code: ErrorCode, readonly retryable = false) {
    super(code);
    this.name = "ExpertClientError";
  }
}

export function createExpertNativeClient(transport: (command: string, args: { request: unknown }) => Promise<unknown> = invoke) {
  async function call<T>(command: Command, contextId: string, payload: unknown, mutation = false): Promise<T> {
    const descriptor = EXPERT_COMMANDS.find(item => item.command === command)!;
    const requestId = crypto.randomUUID();
    const request = { schemaVersion: 1, requestId, contextId, payload };
    const validate = (name: string, value: unknown) => (validators as unknown as Record<string, Validator>)[`validate${name}`]?.(value) === true;
    if (!validate(descriptor.request, request)) throw new ExpertClientError("invalid_request");
    let response: unknown;
    try { response = await transport(command, { request }); }
    catch (error) {
      if (validators.validateError(error) && (error.requestId === requestId || (!mutation && !error.requestId))) throw new ExpertClientError(error.code, error.retryable);
      // An untyped error cannot establish that a mutation did not commit.
      throw new ExpertClientError(mutation ? "outcome_unknown" : "unsupported_capability");
    }
    if (!validate(descriptor.response, response) || (response as Envelope<T>).requestId !== requestId) throw new ExpertClientError(mutation ? "outcome_unknown" : "unsupported_capability");
    return (response as Envelope<T>).data;
  }
  function sameExpert(actual: ExpertSelection | null, requested: ExpertSelection | null): boolean {
    return actual === null ? requested === null : requested !== null && actual.expertId === requested.expertId && actual.version === requested.version;
  }
  function validateBindingOperation(result: BindingSetResponse["data"], sessionId: string, operationId: string) {
    const operation = result.operation;
    const revision = operation.expectedBindingRevision + (operation.state === "succeeded" ? 1 : 0);
    if (operation.operationId !== operationId || operation.sessionId !== sessionId || result.binding.sessionId !== sessionId || operation.bindingRevision !== revision || result.binding.bindingRevision !== revision || (operation.state === "succeeded" && !sameExpert(result.binding.expert, operation.requestedExpert))) throw new ExpertClientError("outcome_unknown");
    return result;
  }
  async function resource(command: "experts_prepare_v1" | "experts_remove_v1", contextId: string, expert: ExpertSelection, operationId: string): Promise<ResourceOperation> {
    const result = await call<PrepareResponse["data"]>(command, contextId, { expert: expertSelection(expert), operationId }, true);
    if (result.operationId !== operationId || !sameExpert(result.expert, expert) || result.action !== (command === "experts_prepare_v1" ? "prepare" : "remove")) throw new ExpertClientError("outcome_unknown");
    return result;
  }
  return {
    async developer(contextId: string, expert: ExpertSelection): Promise<DeveloperInfo> {
      const result = await call<DeveloperInfo>("experts_developer_read_v1", contextId, expertSelection(expert));
      if (!sameExpert(result.expert, expert)) throw new ExpertClientError("unsupported_capability");
      return result;
    },
    async snapshot(contextId: string): Promise<CatalogSnapshot> {
      const result = await call<SnapshotResponse["data"]>("experts_snapshot_v1", contextId, {});
      if (new Set(result.experts.map(item => `${item.display.expertId}@${item.display.version}`)).size !== result.experts.length || result.experts.some(item => item.operation && !sameExpert(item.operation.expert, item.display))) throw new ExpertClientError("unsupported_capability");
      return result;
    },
    prepare: (contextId: string, expert: ExpertSelection, operationId: string) => resource("experts_prepare_v1", contextId, expert, operationId),
    remove: (contextId: string, expert: ExpertSelection, operationId: string) => resource("experts_remove_v1", contextId, expert, operationId),
    async operation(contextId: string, operationId: string) {
      const result = await call<ResourceOperation>("experts_operation_read_v1", contextId, { operationId });
      if (result.operationId !== operationId) throw new ExpertClientError("outcome_unknown");
      return result;
    },
    async recoverOperation(contextId: string, operationId: string) {
      const result = await call<ResourceOperation>("experts_operation_recover_v1", contextId, { operationId }, true);
      if (result.operationId !== operationId) throw new ExpertClientError("outcome_unknown");
      return result;
    },
    async binding(contextId: string, sessionId: string) {
      const result = await call<BindingReadResponse["data"]>("chat_expert_binding_read_v1", contextId, { sessionId });
      if (result.sessionId !== sessionId) throw new ExpertClientError("binding_unavailable");
      return result;
    },
    async setBinding(contextId: string, payload: BindingSetPayload) {
      const result = await call<BindingSetResponse["data"]>("chat_expert_binding_set_v1", contextId, payload, true);
      const operation = result.operation;
      const revision = payload.expectedBindingRevision + (operation.state === "succeeded" ? 1 : 0);
      if (operation.operationId !== payload.operationId || operation.sessionId !== payload.sessionId || result.binding.sessionId !== payload.sessionId || operation.expectedBindingRevision !== payload.expectedBindingRevision || operation.bindingRevision !== revision || result.binding.bindingRevision !== revision || !sameExpert(operation.requestedExpert, payload.expert) || (operation.state === "succeeded" && !sameExpert(result.binding.expert, payload.expert))) throw new ExpertClientError("outcome_unknown");
      return result;
    },
    async bindingOperation(contextId: string, sessionId: string, operationId: string) {
      const result = await call<BindingSetResponse["data"]>("chat_expert_binding_operation_read_v1", contextId, { sessionId, operationId });
      return validateBindingOperation(result, sessionId, operationId);
    },
    async recoverBinding(contextId: string, sessionId: string, operationId: string) {
      const result = await call<BindingSetResponse["data"]>("chat_expert_binding_recover_v1", contextId, { sessionId, operationId }, true);
      return validateBindingOperation(result, sessionId, operationId);
    },
    async submit(contextId: string, payload: NativeSubmitPayload) {
      const result = await call<NativeSubmitResponse["data"]>("chat_expert_submit_v1", contextId, payload, true);
      const receipt = result.receipt;
      if (receipt.submissionOperationId !== payload.submission.operationId || (payload.submission.sessionId && receipt.sessionId !== payload.submission.sessionId) || result.bindingRevision !== payload.expectedBindingRevision || !sameExpert(result.expert, payload.expert)) throw new ExpertClientError("outcome_unknown");
      // The referenced legacy receipt is forward-compatible. Return only its
      // public source-defined fields; never retain arbitrary Native extras.
      return { ...result, receipt: { outcome: receipt.outcome, sessionId: receipt.sessionId, localTurnId: receipt.localTurnId, submissionOperationId: receipt.submissionOperationId, turnOperationId: receipt.turnOperationId, selectionDigest: receipt.selectionDigest } };
    },
  };
}
export const expertNativeClient = createExpertNativeClient();
export type ExpertNativeClient = ReturnType<typeof createExpertNativeClient>;
