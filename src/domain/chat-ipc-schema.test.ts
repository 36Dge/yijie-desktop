import { readFileSync } from "node:fs";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

type PrivateSchema = Readonly<{
  $id: string;
}>;

const schema = JSON.parse(readFileSync(
  new URL("../../src-tauri/schemas/chat-ipc-v2.schema.json", import.meta.url),
  "utf8",
)) as PrivateSchema;

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const keyword of [
  "x-yijie-schema-version",
  "x-yijie-public-chat-time-projection",
  "x-yijie-attachment-import-event-channel",
  "x-yijie-command-names",
  "x-yijie-command-contracts",
  "x-yijie-error-codes",
  "x-yijie-attachment-issues",
  "x-yijie-max-utf8-bytes",
  "x-yijie-forbid-nul",
  "x-yijie-absolute-path",
]) {
  ajv.addKeyword(keyword);
}
ajv.addSchema(schema);

function validator(definition: string): ValidateFunction {
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${definition}`);
  if (!validate) throw new Error(`Missing private IPC schema definition: ${definition}`);
  return validate;
}

const imageAttachment = Object.freeze({
  attachmentId: "019c1a00-0000-7000-8000-000000000020",
  type: "image",
  name: "synthetic-image.png",
  mediaType: "image/png",
  sizeBytes: 2048,
  status: "ready",
  expiresAt: 1_786_387_200,
});

const historyResponse = Object.freeze({
  schemaVersion: 2,
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
        role: "user",
        content: "检查图片",
        contentBlocks: [
          { type: "text", text: "检查图片" },
          { ...imageAttachment, status: "bound" },
        ],
        status: "complete",
        ordinal: 1,
        createdAt: 1_785_000_002,
      }],
      reasoning: [],
    }],
    nextCursor: null,
  },
});

describe("private chat IPC v2 JSON Schema", () => {
  it("accepts valid attachment and history instances", () => {
    expect(validator("attachment")(imageAttachment), JSON.stringify(validator("attachment").errors)).toBe(true);
    expect(
      validator("historyPageResponse")(historyResponse),
      JSON.stringify(validator("historyPageResponse").errors),
    ).toBe(true);
  });

  it("rejects attachment type and media-type mismatches", () => {
    const validate = validator("attachment");
    expect(validate({ ...imageAttachment, mediaType: "application/pdf" })).toBe(false);
    expect(validate({ ...imageAttachment, type: "file" })).toBe(false);
  });

  it("rejects invalid persisted history blocks and missing text projections", () => {
    const validate = validator("historyPageResponse");
    const readyHistory = structuredClone(historyResponse);
    const readyHistoryAttachment = readyHistory.data.turns[0]!.messages[0]!.contentBlocks[1] as {
      status: string;
    };
    readyHistoryAttachment.status = "ready";
    expect(validate(readyHistory)).toBe(false);

    const missingContent = structuredClone(historyResponse) as {
      data: { turns: Array<{ messages: Array<{ content?: string }> }> };
    };
    delete missingContent.data.turns[0]!.messages[0]!.content;
    expect(validate(missingContent)).toBe(false);
  });

  it("rejects duplicate native drag paths", () => {
    const validate = validator("importAttachmentsRequest");
    expect(validate({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000024",
      contextId: "019c1a00-0000-7000-8000-000000000003",
      payload: {
        paths: ["/tmp/synthetic.pdf", "/tmp/synthetic.pdf"],
        draftTarget: { type: "new" },
        operationId: "019c1a00-0000-7000-8000-000000000025",
        remainingCapacity: 2,
      },
    })).toBe(false);
  });

  it("keeps draft targets closed, explicit, and non-nil", () => {
    const validate = validator("draftTarget");
    expect(validate({ type: "new" }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      type: "session",
      sessionId: "019c1a00-0000-7000-8000-000000000026",
    }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ type: "new", sessionId: "019c1a00-0000-7000-8000-000000000026" })).toBe(false);
    expect(validate({ type: "session" })).toBe(false);
    expect(validate({ type: "session", sessionId: "00000000-0000-0000-0000-000000000000" })).toBe(false);

    const listRequest = validator("listDraftAttachmentsRequest");
    expect(listRequest({
      schemaVersion: 2,
      requestId: "019c1a00-0000-7000-8000-000000000024",
      contextId: "019c1a00-0000-7000-8000-000000000003",
      payload: {},
    })).toBe(false);
  });

  it("accepts only closed attachment import failure reasons", () => {
    const validate = validator("error");
    expect(validate({
      schemaVersion: 2,
      code: "chat_request_invalid",
      retryable: false,
      recovery: "fix_request",
      attachmentIssue: "archive_unsupported",
      attachmentItemCount: 2,
    }), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({
      schemaVersion: 2,
      code: "chat_request_invalid",
      retryable: false,
      recovery: "fix_request",
      attachmentIssue: "private_path_leak",
    })).toBe(false);
  });

  it("keeps attachment progress aggregate and free of file metadata", () => {
    const validate = validator("attachmentImportEvent");
    const event = {
      schemaVersion: 2,
      contextId: "019c1a00-0000-7000-8000-000000000003",
      operationId: "019c1a00-0000-7000-8000-000000000024",
      sequence: "4",
      stage: "indexing",
      itemCount: 2,
      issue: null,
    };
    expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...event, name: "private.pdf" })).toBe(false);
    expect(validate({ ...event, path: "/private/private.pdf" })).toBe(false);
    expect(validate({ ...event, attachment: imageAttachment })).toBe(false);
    expect(validate({ ...event, stage: "error_terminal", issue: null })).toBe(false);
    expect(validate({ ...event, stage: "error_terminal", issue: "parse_failed" })).toBe(true);
  });
});
