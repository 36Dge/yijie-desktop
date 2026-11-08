import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { createChatClient } from "./chat-client";
import { CHAT_COMMAND_NAMES } from "../domain/chat-ipc";

describe("chat authority renewal private contract", () => {
  it("uses the canonical request and existing response without sending renderer authority", async () => {
    const schema = JSON.parse(readFileSync(new URL("../../src-tauri/schemas/chat-ipc-v1.schema.json", import.meta.url), "utf8"));
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(schema);
    const command = "chat_renew_context_v1";
    const contract = schema["x-yijie-command-contracts"][command];
    const validateRequest = ajv.getSchema(`${schema.$id}${contract.request}`)!;
    const validateResponse = ajv.getSchema(`${schema.$id}${contract.response}`)!;
    const contextId = "019c1a00-0000-7000-8000-000000000003";
    const tenant = "019c1a00-0000-7000-8000-000000000002";
    const data = { contextId, expiresAtEpochSeconds: 2_000_000_000, allowedActions: ["read_sessions"] };
    const invoke = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      expect(name).toBe(command);
      const request = args?.request as { requestId: string };
      expect(validateRequest(request), JSON.stringify(validateRequest.errors)).toBe(true);
      expect(request).toEqual({ schemaVersion: 1, requestId: expect.any(String), contextId, payload: { tenantSelector: tenant } });
      const response = { schemaVersion: 1, requestId: request.requestId, data };
      expect(validateResponse(response), JSON.stringify(validateResponse.errors)).toBe(true);
      return response;
    });
    const client = createChatClient({ invoke, listen: async () => () => undefined });
    expect(CHAT_COMMAND_NAMES).toEqual(schema["x-yijie-command-names"]);
    expect(await client.renewContext!(contextId, tenant)).toEqual(data);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
