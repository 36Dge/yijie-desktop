import { invoke } from "@tauri-apps/api/core";
import { ChatClientError, ChatContractError, parseChatIpcError, parseProject } from "../domain/chat-ipc";
import type { ChatWorkspace, WorkspaceCatalog, WorkspaceCreation } from "../domain/chat-workspace";

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChatContractError();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record))) throw new ChatContractError();
  return record;
}
function path(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 4096 || value.includes("\0")) throw new ChatContractError();
  return value;
}
function workspace(value: unknown): ChatWorkspace {
  const record = exact(value, ["project", "path"]);
  const project = parseProject(record.project);
  if ((record.path !== null) !== project.available) throw new ChatContractError();
  return { project, path: record.path === null ? null : path(record.path) };
}
export function parseWorkspaceCatalog(value: unknown): WorkspaceCatalog {
  const record = exact(value, ["rootPath", "workspaces"]);
  if (!Array.isArray(record.workspaces) || record.workspaces.length > 256) throw new ChatContractError();
  const workspaces = record.workspaces.map(workspace);
  if (new Set(workspaces.map(entry => entry.project.projectId)).size !== workspaces.length) throw new ChatContractError();
  return { rootPath: path(record.rootPath), workspaces };
}
export function parseWorkspaceCreation(value: unknown): WorkspaceCreation {
  const record = exact(value, ["status", "workspace"]);
  if (record.status === "created") {
    const entry = workspace(record.workspace);
    if (!entry.project.available) throw new ChatContractError();
    return { status: "created", workspace: entry };
  }
  if (!["name_conflict", "invalid_name", "unavailable"].includes(record.status as string) || record.workspace !== null) throw new ChatContractError();
  return record as unknown as WorkspaceCreation;
}

export function createChatWorkspaceClient(nativeInvoke: typeof invoke = invoke) {
  async function call<T>(command: string, contextId: string, payload: Record<string, unknown>, parse: (value: unknown) => T): Promise<T> {
    const requestId = crypto.randomUUID();
    let raw: unknown;
    try {
      raw = await nativeInvoke(command, { request: { schemaVersion: 1, requestId, contextId, payload } });
    } catch (error) {
      try { throw new ChatClientError(parseChatIpcError(error)); }
      catch (mapped) { if (mapped instanceof ChatClientError) throw mapped; throw new ChatContractError(); }
    }
    const response = exact(raw, ["schemaVersion", "requestId", "data"]);
    if (response.schemaVersion !== 1 || response.requestId !== requestId) throw new ChatContractError();
    return parse(response.data);
  }
  return {
    catalog: (contextId: string) => call("chat_workspace_catalog_v1", contextId, {}, parseWorkspaceCatalog),
    create: (contextId: string, name: string) => call("chat_create_workspace_v1", contextId, { name }, parseWorkspaceCreation),
  };
}
export const chatWorkspaceClient = createChatWorkspaceClient();
