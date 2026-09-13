import { invoke } from "@tauri-apps/api/core";
import type { components } from "../domain/workflow-local.generated";
import { validators } from "./generated/workflow-local-validator.gen.js";

export type WorkflowSchemas = components["schemas"];
export type Workflow = WorkflowSchemas["Workflow"];
export type WorkflowSummary = WorkflowSchemas["WorkflowSummary"];
export type EditorOpenedView = WorkflowSchemas["EditorOpenedView"];
export type WorkflowErrorCode = WorkflowSchemas["ErrorCode"];

const messages: Record<WorkflowErrorCode, string> = {
  profile_disabled: "本地工作流尚未启用，请通过工作流演示入口打开应用。",
  service_unavailable: "工作流服务暂不可用，完成本地启动后可重试。",
  unauthorized: "当前本地身份无法访问此工作流。",
  session_expired: "编辑会话已到期，草稿已保留，请重新连接。",
  resource_not_found: "工作流不存在或当前身份无法访问。",
  revision_conflict: "草稿已在其他位置更新，请保留当前修改并核对版本。",
  operation_conflict: "此操作已登记，请查询原操作后继续。",
  invalid_draft: "草稿尚未完成，请检查开始、文本拼接、结束节点及连线。",
  input_too_large: "输入或画布超过当前工作流的容量限制。",
  run_busy: "已有工作流正在运行，请等待真实结果。",
  operation_unknown: "操作结果尚不确定，请先查询原操作，避免重复提交。",
  protocol_mismatch: "工作流协议不匹配，请检查本地组件版本。",
  invalid_request: "工作流请求无效，请检查输入。",
  storage_unavailable: "工作流存储暂不可用，请稍后重试读取。",
  internal_error: "工作流服务处理失败，请保留草稿并检查状态。",
};

export class WorkflowNativeError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    readonly operationId?: string,
  ) {
    super(messages[code]);
    this.name = "WorkflowNativeError";
  }

  toWire(): WorkflowSchemas["ErrorResponse"] {
    return {
      code: this.code,
      message: this.message,
      ...(this.operationId ? { operation_id: this.operationId } : {}),
    };
  }
}

export function workflowFailure(value: unknown): WorkflowNativeError {
  if (value instanceof WorkflowNativeError) return value;
  if (validators.ErrorResponse(value)) {
    return new WorkflowNativeError(value.code, value.operation_id);
  }
  // Neither provider text nor arbitrary native exception details reach the UI.
  return new WorkflowNativeError("service_unavailable");
}

type Invoker = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type SchemaName = keyof WorkflowSchemas;

export function createWorkflowNativeClient(nativeInvoke: Invoker = invoke) {
  async function call<Output extends SchemaName>(
    command: string,
    output: Output,
    input?: SchemaName,
    request?: unknown,
  ): Promise<WorkflowSchemas[Output]> {
    if (input && !validators[input](request)) {
      throw new WorkflowNativeError("invalid_request");
    }
    const write = command === "workflow_create" || command === "workflow_run_start"
      || (command === "workflow_editor_exchange"
        && validators.EditorExchangeInput(request)
        && ["save_draft", "test_draft", "publish_internal"].includes(request.operation));
    try {
      const value = await nativeInvoke(command, input ? { request } : undefined);
      if (!validators[output](value)) {
        throw new WorkflowNativeError(write ? "operation_unknown" : "protocol_mismatch");
      }
      return value as WorkflowSchemas[Output];
    } catch (error) {
      // A typed native rejection distinguishes preflight failures from writes
      // with an operation ID. An untyped IPC failure after dispatch cannot.
      if (write && !(error instanceof WorkflowNativeError) && !validators.ErrorResponse(error)) {
        throw new WorkflowNativeError("operation_unknown");
      }
      throw workflowFailure(error);
    }
  }

  return {
    status: () => call("workflow_service_status", "ServiceStatus"),
    list: (request: WorkflowSchemas["ListRequest"]) =>
      call("workflow_list", "WorkflowList", "ListRequest", request),
    create: (request: WorkflowSchemas["CreateInput"]) =>
      call("workflow_create", "Workflow", "CreateInput", request),
    open: (request: WorkflowSchemas["EditorOpenRequest"]) =>
      call("workflow_editor_open", "EditorOpenedView", "EditorOpenRequest", request),
    exchange: (request: WorkflowSchemas["EditorExchangeInput"]) =>
      call("workflow_editor_exchange", "EditorExchangeResult", "EditorExchangeInput", request),
    close: (request: WorkflowSchemas["EditorCloseInput"]) =>
      call("workflow_editor_close", "CloseResult", "EditorCloseInput", request),
    run: (request: WorkflowSchemas["RunInput"]) =>
      call("workflow_run_start", "Run", "RunInput", request),
    query: (request: WorkflowSchemas["RunQueryInput"]) =>
      call("workflow_run_query", "RunQueryResult", "RunQueryInput", request),
  };
}

export type WorkflowNativeClient = ReturnType<typeof createWorkflowNativeClient>;
export const workflowNativeClient = createWorkflowNativeClient();
