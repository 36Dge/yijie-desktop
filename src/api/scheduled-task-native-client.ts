import { invoke } from "@tauri-apps/api/core";
import { commands, type Requests, type Responses, type IpcErrorCode } from "./generated/scheduled-task-ipc.gen";
import * as validators from "./generated/scheduled-task-ipc-validator.gen.js";

type Command = keyof Requests;
type Invoker = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export class ScheduledTaskNativeError extends Error {
  constructor(readonly code: IpcErrorCode, readonly requestId: string) {
    super(code);
    this.name = "ScheduledTaskNativeError";
  }
}
/** Thin typed IPC only. Context and logical request IDs come from the existing UI
 * context / explicit action; this client never binds, activates, or retries. */
export function createScheduledTaskNativeClient(nativeInvoke: Invoker = invoke) {
  return {
    async call<C extends Command>(command: C, request: Requests[C]): Promise<Responses[C]> {
      const requestId = request.requestId;
      const spec = commands[command];
      const validateRequest = validators[`validate${spec.request}`];
      if (!validateRequest(request)) throw new ScheduledTaskNativeError("invalid_input", requestId);
      const uncertain = spec.write ? "operation_unknown" : "protocol_mismatch";
      let response: unknown;
      try {
        response = await nativeInvoke(command, { request });
      } catch (error) {
        if (validators.validateErrorResponse(error) && error.requestId === requestId) {
          throw new ScheduledTaskNativeError(error.code, requestId);
        }
        throw new ScheduledTaskNativeError(uncertain, requestId);
      }
      if (!validators[`validate${spec.response}`](response) || response.requestId !== requestId) {
        throw new ScheduledTaskNativeError(uncertain, requestId);
      }
      return response as Responses[C];
    },
  };
}
