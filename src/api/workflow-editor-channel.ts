import type { WorkflowEditorBridgeV1 } from "../domain/workflow-editor-bridge.generated";
import { validateBridge } from "./generated/workflow-local-validator.gen.js";
import {
  WorkflowNativeError,
  workflowFailure,
  type EditorOpenedView,
  type WorkflowNativeClient,
  type WorkflowSchemas,
} from "./workflow-native-client";

export const WORKFLOW_EDITOR_ORIGIN = "http://127.0.0.1:18888";
export const WORKFLOW_EDITOR_URL = `${WORKFLOW_EDITOR_ORIGIN}/editor/`;
const MAX_MESSAGE_BYTES = 524_288;

export interface EditorChannelHooks {
  ready(): void;
  dirty(value: boolean): void;
  requestClose(): void;
  result(value: WorkflowSchemas["EditorExchangeResult"]): void;
  failure(value: WorkflowNativeError): void;
  busy(writes: number): void;
}

export function validEditorEnvelope(value: unknown): value is WorkflowEditorBridgeV1 {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_MESSAGE_BYTES
      && validateBridge(value);
  } catch {
    return false;
  }
}

/** One already-authorized native editor binding owns exactly one MessagePort. */
export class WorkflowEditorChannel {
  private readonly port: MessagePort;
  private readonly requests = new Set<string>();
  private readonly writes = new Set<string>();
  private disposed = false;
  private connected = false;
  private readonly handshakeTimer: ReturnType<typeof setTimeout>;

  constructor(
    frame: HTMLIFrameElement,
    private readonly view: EditorOpenedView,
    private readonly native: WorkflowNativeClient,
    private readonly hooks: EditorChannelHooks,
  ) {
    if (frame.src !== WORKFLOW_EDITOR_URL || !frame.contentWindow) {
      throw new WorkflowNativeError("protocol_mismatch");
    }
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event: MessageEvent<unknown>) => { void this.receive(event.data); };
    this.port.onmessageerror = () => this.hooks.failure(new WorkflowNativeError("protocol_mismatch"));
    this.port.start();
    this.handshakeTimer = setTimeout(() => {
      if (!this.disposed && !this.connected) {
        this.hooks.failure(new WorkflowNativeError("service_unavailable"));
      }
    }, 10_000);
    const connect: WorkflowEditorBridgeV1 = {
      kind: "connect",
      protocol_version: 1,
      request_id: crypto.randomUUID(),
      bridge_id: view.bridge_id,
      generation: view.generation,
    };
    frame.contentWindow.postMessage(connect, WORKFLOW_EDITOR_ORIGIN, [channel.port2]);
  }

  close(): void {
    this.disposed = true;
    this.connected = false;
    clearTimeout(this.handshakeTimer);
    this.port.onmessage = null;
    this.port.onmessageerror = null;
    this.port.close();
  }

  private reply(value: WorkflowEditorBridgeV1): void {
    if (this.disposed) return;
    if (!validEditorEnvelope(value)) {
      this.hooks.failure(new WorkflowNativeError("protocol_mismatch"));
      return;
    }
    this.port.postMessage(value);
  }

  private async receive(value: unknown): Promise<void> {
    if (this.disposed) return;
    if (!validEditorEnvelope(value)
      || value.bridge_id !== this.view.bridge_id
      || value.generation !== this.view.generation) {
      this.hooks.failure(new WorkflowNativeError("protocol_mismatch"));
      return;
    }
    if (value.kind === "ready") {
      if (this.connected) return;
      this.connected = true;
      clearTimeout(this.handshakeTimer);
      this.hooks.ready();
      return;
    }
    if (!this.connected) return;
    if (value.kind === "dirty_changed") {
      this.hooks.dirty(value.dirty);
      return;
    }
    if (value.kind === "request_close") {
      this.hooks.requestClose();
      return;
    }
    if (value.kind !== "request") return;
    const input = value.request;
    const envelope = {
      kind: "response" as const,
      protocol_version: 1 as const,
      request_id: value.request_id,
      bridge_id: this.view.bridge_id,
      generation: this.view.generation,
    };
    let write = false;
    try {
      if (input.protocol_version !== value.protocol_version
        || input.request_id !== value.request_id
        || input.bridge_id !== value.bridge_id
        || input.generation !== value.generation) {
        throw new WorkflowNativeError("protocol_mismatch");
      }
      if (Date.now() >= this.view.expires_at_ms) throw new WorkflowNativeError("session_expired");
      if (this.requests.has(value.request_id) || this.requests.size >= 2048) {
        throw new WorkflowNativeError("operation_conflict");
      }
      this.requests.add(value.request_id);
      write = ["save_draft", "test_draft", "publish_internal"].includes(input.operation);
      if (write) {
        this.writes.add(value.request_id);
        this.hooks.busy(this.writes.size);
      }
      const result = await this.native.exchange(input);
      if (this.disposed) return;
      if (result.request_id !== value.request_id
        || (result.workflow && result.workflow.workflow_id !== this.view.workflow.workflow_id)
        || (result.bootstrap && result.bootstrap.workflow.workflow_id !== this.view.workflow.workflow_id)
        || (result.run && result.run.workflow_id !== this.view.workflow.workflow_id)) {
        throw new WorkflowNativeError("protocol_mismatch");
      }
      this.reply({ ...envelope, response: result });
      this.hooks.result(result);
    } catch (error) {
      if (this.disposed) return;
      const failure = workflowFailure(error);
      this.reply({ ...envelope, error: failure.toWire() });
      this.hooks.failure(failure);
    } finally {
      if (write) this.writes.delete(value.request_id);
      if (!this.disposed) this.hooks.busy(this.writes.size);
    }
  }
}
