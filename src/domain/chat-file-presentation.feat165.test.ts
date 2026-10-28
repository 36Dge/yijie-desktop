import { describe, expect, it } from "vitest";
import { chatFilePresentation, fileNameParts } from "./chat-file-presentation";
import { parseAttachmentPresentationResponse, parseAttachmentListResponse } from "./chat-ipc";
import { iconRegistry } from "../icons/registry";
const requestId = "019c1a00-0000-7000-8000-000000000020";
describe("FEAT165 private draft presentation", () => {
  it("keeps SVG and MP4 as file records while SVG uses the image display", () => {
    for (const mediaType of ["image/svg+xml", "video/mp4"] as const) {
      const value = parseAttachmentListResponse({schemaVersion: 2, requestId, data: [{attachmentId: requestId, type: "file", name: mediaType.startsWith("image/") ? "sample.svg" : "sample.mp4", mediaType, sizeBytes: 400, status: "ready", expiresAt: 2_000_000_000}]});
      expect(value[0]?.type).toBe("file");
      expect(chatFilePresentation(mediaType).image).toBe(mediaType === "image/svg+xml");
    }
  });
  it("parses the scoped native projection without adding a message field", () => {
    const result = parseAttachmentPresentationResponse({schemaVersion: 2, requestId, data: {sourcePath: "/ordinary/sample.csv", imageUrl: null, expiresAt: 2_000_000_000}});
    expect(result.sourcePath).toBe("/ordinary/sample.csv");
    expect(Object.keys(result)).toEqual(["sourcePath", "imageUrl", "expiresAt"]);
  });
  it("preserves JPEG aliases and the extension for a long display name", () => {
    expect(fileNameParts("正常的长文件名.jpeg")).toEqual({stem: "正常的长文件名", extension: ".jpeg"});
    expect(chatFilePresentation("image/jpeg").icon).toBe("fileJpeg");
    expect(chatFilePresentation("application/pdf").label).toBe("PDF");
  });
  it("distinguishes all eleven format families by the rendered registry icon", () => {
    const mediaTypes = ["text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "text/markdown", "text/plain", "image/jpeg", "image/png", "image/svg+xml", "text/html", "application/pdf", "video/mp4"];
    const icons = mediaTypes.map(mime => iconRegistry[chatFilePresentation(mime).icon]);
    expect(new Set(icons).size).toBe(mediaTypes.length);
  });
});
