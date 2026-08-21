import { describe, expect, it, vi } from "vitest";
import { createChatArtifactReportNativeClient } from "./chat-artifact-report-native-client";

describe("ChatArtifactReportNativeClient", () => {
  it("invokes only the two exact private report commands", async () => {
    const invoke = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      requestId: "018f0000-0000-7000-8000-000000000005",
      data: {
        schemaVersion: 1,
        title: "Safe",
        generatedAt: "2026-08-20T02:00:00Z",
        sourceTime: null,
        truncated: false,
        sections: [],
      },
    });
    const client = createChatArtifactReportNativeClient(invoke);
    await client.readReportPreview("018f0000-0000-7000-8000-000000000004", {
      sessionId: "018f0000-0000-7000-8000-000000000001",
      turnId: "018f0000-0000-7000-8000-000000000002",
      artifactId: "018f0000-0000-7000-8000-000000000003",
    });
    expect(invoke).toHaveBeenCalledWith(
      "chat_read_artifact_report_preview_v1",
      expect.objectContaining({ request: expect.any(Object) }),
    );
  });

  it("uses the exact canonical report save command", async () => {
    const invoke = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      requestId: "018f0000-0000-7000-8000-000000000005",
      data: { status: "saved", code: null },
    });
    const client = createChatArtifactReportNativeClient(invoke);
    await client.saveReport("018f0000-0000-7000-8000-000000000004", {
      sessionId: "018f0000-0000-7000-8000-000000000001",
      turnId: "018f0000-0000-7000-8000-000000000002",
      artifactId: "018f0000-0000-7000-8000-000000000003",
    });
    expect(invoke).toHaveBeenCalledWith(
      "chat_save_artifact_report_v1",
      expect.objectContaining({ request: expect.any(Object) }),
    );
  });

  it("maps arbitrary native details to the stable content-free fallback", async () => {
    const client = createChatArtifactReportNativeClient(async () => {
      throw { message: "secret /Users/example/report.json", rawDocument: "sensitive" };
    });
    await expect(client.saveReport("018f0000-0000-7000-8000-000000000004", {
      sessionId: "018f0000-0000-7000-8000-000000000001",
      turnId: "018f0000-0000-7000-8000-000000000002",
      artifactId: "018f0000-0000-7000-8000-000000000003",
    })).rejects.toMatchObject({ shape: { code: "artifact_native_unavailable" } });
  });
});
