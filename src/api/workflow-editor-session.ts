import {
  WorkflowNativeError,
  workflowFailure,
  type EditorOpenedView,
  type WorkflowNativeClient,
  type WorkflowSchemas,
} from "./workflow-native-client";

// Rotate the native-only credential before its five-minute limit. The mounted
// editor and its page-local draft have a separate, page-long lifetime.
const RENEW_BEFORE_MS = 60_000;

export class WorkflowEditorSession {
  private view: EditorOpenedView;
  private queue: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    view: EditorOpenedView,
    private readonly native: WorkflowNativeClient,
    private readonly renewed: (view: EditorOpenedView) => void,
    private readonly failed: (failure: WorkflowNativeError) => void,
  ) { this.view = view; }

  owns(view: EditorOpenedView): boolean {
    return this.view.bridge_id === view.bridge_id && this.view.generation === view.generation;
  }

  start(): void { this.schedule(); }

  close(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(() => {
      void this.enqueue(() => this.renew()).catch(error => {
        if (!this.disposed) this.failed(workflowFailure(error));
      });
    }, Math.max(0, this.view.expires_at_ms - Date.now() - RENEW_BEFORE_MS));
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(() => {
      if (this.disposed) throw new WorkflowNativeError("session_expired");
      return operation();
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }

  private async renew(force = false): Promise<void> {
    if (!force && Date.now() < this.view.expires_at_ms - RENEW_BEFORE_MS) {
      this.schedule();
      return;
    }
    clearTimeout(this.timer);
    // This existing native operation rechecks identity, resource ownership and
    // epoch, retires the old credential, then installs a new bounded credential.
    // It runs between exchanges, never during a dispatched save/test/publish.
    const opened = await this.native.open({ workflow_id: this.view.workflow.workflow_id });
    if (this.disposed) {
      await this.native.close({ bridge_id: opened.bridge_id });
      return;
    }
    if (opened.workflow.workflow_id !== this.view.workflow.workflow_id
      || opened.protocol_version !== this.view.protocol_version
      || opened.expires_at_ms <= Date.now() + RENEW_BEFORE_MS) {
      await this.native.close({ bridge_id: opened.bridge_id });
      throw new WorkflowNativeError("protocol_mismatch");
    }
    this.renewed(opened);
    this.view = opened;
    this.schedule();
  }

  exchange(input: WorkflowSchemas["EditorExchangeInput"]): Promise<WorkflowSchemas["EditorExchangeResult"]> {
    return this.enqueue(async () => {
      // Also covers a normal OS sleep/resume with a suspended timer.
      await this.renew();
      const send = () => {
        if (this.disposed) throw new WorkflowNativeError("session_expired");
        return this.native.exchange({ ...input, bridge_id: this.view.bridge_id, generation: this.view.generation });
      };
      try {
        return await send();
      } catch (error) {
        const failure = workflowFailure(error);
        // A typed preflight expiry has no submitted operation. Never replay an
        // unknown result or any rejection carrying an operation receipt ID.
        if (failure.code !== "session_expired" || failure.operationId || this.disposed) throw error;
        await this.renew(true);
        return send();
      }
    });
  }
}
