import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

type PrivateSchema = Readonly<{ $id: string }>;

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-ipc-v3.schema.json", import.meta.url),
  "utf8",
)) as PrivateSchema;

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const keyword of [
  "x-yijie-schema-version",
  "x-yijie-public-chat-time-projection",
  "x-yijie-command-names",
  "x-yijie-command-contracts",
  "x-yijie-forbid-nul",
]) {
  ajv.addKeyword(keyword);
}
ajv.addSchema(schema);

function validator(definition: string): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`Missing private IPC v3 schema definition: ${definition}`);
  return validate;
}

const historyResponse = Object.freeze({
  schemaVersion: 3,
  requestId: "019c1a00-0000-7000-8000-000000000021",
  data: {
    turns: [{
      turnId: "019c1a00-0000-7000-8000-000000000022",
      status: "completed",
      terminalAt: 1_785_000_003,
      reasoningStatus: "complete",
      reasoningReasonCode: null,
      messages: [{
        messageId: "019c1a00-0000-7000-8000-000000000023",
        role: "assistant",
        content: "完成",
        contentBlocks: [{ type: "text", text: "完成" }],
        status: "committed",
        ordinal: 1,
        createdAt: 1_785_000_002,
      }],
      reasoning: [],
      artifacts: [{
        artifactId: "019c1a00-0000-7000-8000-000000000024",
        kind: "video",
        provenance: "synthetic",
        status: "ready",
        ordinal: 2,
        progressStage: null,
        progressPercent: null,
        displayName: "synthetic.mp4",
        mediaType: "video/mp4",
        sizeBytes: 1_642,
        localCommittedAt: 1_785_000_004,
        expiresAt: 1_785_604_804,
        hasPoster: true,
        errorCode: null,
        retryable: null,
      }],
    }],
    nextCursor: null,
  },
});

describe("private chat IPC v3 JSON Schema", () => {
  it("accepts bounded artifact history without bytes, hrefs, digests, or paths", () => {
    const validate = validator("historyPageResponse");
    expect(validate(historyResponse), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.stringify(historyResponse)).not.toMatch(
      /"(?:sha256|contentHref|token|path|bytes)"/i,
    );
  });

  it("rejects leaked authority fields and wrong kind/media combinations", () => {
    const validate = validator("historyPageResponse");
    const leaked = structuredClone(historyResponse) as {
      data: { turns: Array<{ artifacts: Array<Record<string, unknown>> }> };
    };
    leaked.data.turns[0]!.artifacts[0]!.sha256 = "a".repeat(64);
    expect(validate(leaked)).toBe(false);

    const wrongMedia = structuredClone(historyResponse);
    wrongMedia.data.turns[0]!.artifacts[0]!.mediaType = "application/pdf";
    expect(validate(wrongMedia)).toBe(false);
  });

  it("keeps request and error envelopes on schema version 3", () => {
    const request = validator("sessionReadRequest");
    expect(request({
      schemaVersion: 3,
      requestId: "019c1a00-0000-7000-8000-000000000025",
      contextId: "019c1a00-0000-7000-8000-000000000026",
      payload: { sessionId: "019c1a00-0000-7000-8000-000000000027" },
    }), JSON.stringify(request.errors)).toBe(true);
    expect(request({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000025",
      contextId: "019c1a00-0000-7000-8000-000000000026",
      payload: { sessionId: "019c1a00-0000-7000-8000-000000000027" },
    })).toBe(false);
  });
});
