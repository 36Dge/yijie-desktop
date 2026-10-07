import { describe, expect, it, vi } from "vitest";
import type { invoke } from "@tauri-apps/api/core";
import { createChatWorkspaceClient, parseWorkspaceCatalog, parseWorkspaceCreation } from "./chat-workspace-client";

const project = { projectId: "019c1a00-0000-7000-8000-000000000001", safeName: "市场调研", pinnedAt: null, lastUsedAt: 1, available: true };
const workspace = { project, path: "/Users/example/Yijie/Workspaces/市场调研" };
describe("local workspace client", () => {
  it("uses the versioned native creation command and verifies the response correlation", async () => {
    const transport = vi.fn(async (_command: string, args: unknown) => {
      const request = (args as { request: { requestId: string } }).request;
      return { schemaVersion: 1, requestId: request.requestId, data: { status: "created", workspace } };
    });
    const client = createChatWorkspaceClient(transport as typeof invoke);
    expect(await client.create("019c1a00-0000-7000-8000-000000000002", "市场调研")).toEqual({ status: "created", workspace });
    expect(transport).toHaveBeenCalledWith("chat_create_workspace_v1", { request: expect.objectContaining({ schemaVersion: 1, payload: { name: "市场调研" } }) });
    const mismatched = createChatWorkspaceClient((async () => ({ schemaVersion: 2, requestId: "unknown", data: {} })) as typeof invoke);
    await expect(mismatched.catalog("context")).rejects.toThrow("chat-contract-invalid");
  });
  it("preserves paths locally and unavailable entries while rejecting unknown response states", () => {
    const value = { rootPath: "/Users/example/Yijie/Workspaces", workspaces: [workspace, { project: { ...project, projectId: "019c1a00-0000-7000-8000-000000000002", available: false }, path: null }] };
    expect(parseWorkspaceCatalog(value)).toEqual(value);
    expect(parseWorkspaceCreation({ status: "name_conflict", workspace: null })).toEqual({ status: "name_conflict", workspace: null });
    expect(() => parseWorkspaceCreation({ status: "future_state", workspace: null })).toThrow();
    expect(() => parseWorkspaceCreation({ status: "created", workspace: null })).toThrow();
    expect(() => parseWorkspaceCatalog({ ...value, futureField: true })).toThrow();
  });
});
