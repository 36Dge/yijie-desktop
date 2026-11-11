// @vitest-environment happy-dom

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import type { ChatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactList from "./ChatArtifactList.vue";

const SESSION_ID = "019c1a00-0000-7000-8000-000000000911";
const TURN_ID = "019c1a00-0000-7000-8000-000000000912";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000910";
enableAutoUnmount(afterEach);

function report(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: "019c1a00-0000-7000-8000-000000000913",
    kind: "report",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "报告.json",
    mediaType: "application/vnd.yijie.report+json;version=1",
    sizeBytes: 256,
    localCommittedAt: 1_000,
    expiresAt: 605_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  }));
}

describe("ChatArtifactList report integration", () => {
  it("forwards only the trusted context and typed report client to a ready report", async () => {
    const nativeClient: ChatArtifactReportNativeClient = {
      readReportPreview: vi.fn(async () => ({
        schemaVersion: 1 as const,
        title: "列表透传报告",
        generatedAt: "2026-08-21T08:00:00Z",
        sourceTime: null,
        truncated: false,
        sections: [],
      })),
      saveReport: vi.fn(async () => ({ status: "saved" as const, code: null })),
    };
    const wrapper = mount(ChatArtifactList, {
      props: { artifacts: [report()], contextId: CONTEXT_ID, reportNativeClient: nativeClient },
    });

    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(nativeClient.readReportPreview).toHaveBeenCalledWith(CONTEXT_ID, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: "019c1a00-0000-7000-8000-000000000913",
    });
    expect(wrapper.text()).toContain("列表透传报告");

    await wrapper.setProps({ artifacts: [report({ status: "expired" })] });
    await flushPromises();
    expect(wrapper.find("[data-testid='artifact-report']").exists()).toBe(false);
  });
});

describe("ChatArtifactList document cards", () => {
  const formats = [
    ["md", "text/markdown"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["pdf", "application/pdf"],
  ];
  function client(): ChatArtifactFileNativeClient {
    return {
      readFilePreview: vi.fn(),
      saveFile: vi.fn(async () => ({ status: "cancelled" as const, code: null })),
    };
  }

  it.each(formats)("opens %s in the sidebar and routes Save As separately through the existing native client", async (extension, mediaType) => {
    const file = report({ kind: "file", displayName: `杭州样本.${extension}`, mediaType, sizeBytes: 5837 });
    const openFile = vi.fn();
    const fileNativeClient = client();
    const wrapper = mount(ChatArtifactList, {
      props: { artifacts: [file], contextId: CONTEXT_ID, openFile, fileNativeClient },
    });
    expect(wrapper.text()).toContain(`杭州样本.${extension}`);
    expect(wrapper.text()).toContain("5.7 KB");
    expect(wrapper.find(".chat-artifact-document-card__icon svg").exists()).toBe(true);
    expect(wrapper.find(".artifact-shell, .chat-file-link").exists()).toBe(false);
    expect(fileNativeClient.readFilePreview).not.toHaveBeenCalled();
    expect(fileNativeClient.saveFile).not.toHaveBeenCalled();

    await wrapper.get(`button[aria-label="预览 杭州样本.${extension}"]`).trigger("click");
    expect(openFile).toHaveBeenCalledExactlyOnceWith(file);
    const save = wrapper.get('button[aria-label="另存为"]');
    expect(save.attributes("data-yj-tooltip")).toBe("另存为");
    await save.trigger("click"); await flushPromises();
    expect(fileNativeClient.saveFile).toHaveBeenCalledExactlyOnceWith(CONTEXT_ID, {
      sessionId: SESSION_ID, turnId: TURN_ID, artifactId: file.artifactId,
    });
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".artifact-file__feedback").exists()).toBe(false);
    expect(save.attributes("disabled")).toBeUndefined();
  });

  it("keeps Save As single-flight, permits an explicit retry, and removes expired actions", async () => {
    let finish!: (result: { status: "cancelled"; code: null }) => void;
    const pending = new Promise<{ status: "cancelled"; code: null }>(resolve => { finish = resolve; });
    const file = report({ kind: "file", mediaType: "application/pdf", displayName: "样本.pdf" });
    const fileNativeClient = client();
    vi.mocked(fileNativeClient.saveFile).mockReturnValueOnce(pending)
      .mockResolvedValueOnce({ status: "failed", code: "artifact_native_dialog_unavailable" })
      .mockResolvedValueOnce({ status: "saved", code: null });
    const wrapper = mount(ChatArtifactList, {
      props: { artifacts: [file], contextId: CONTEXT_ID, openFile: vi.fn(), fileNativeClient },
    });
    const save = wrapper.get('button[aria-label="另存为"]');
    await save.trigger("click"); await save.trigger("click");
    expect(fileNativeClient.saveFile).toHaveBeenCalledTimes(1);
    expect(save.attributes("disabled")).toBeDefined();
    expect(wrapper.find(".artifact-file__feedback").exists()).toBe(false);
    finish({ status: "cancelled", code: null }); await flushPromises();
    expect(wrapper.find(".artifact-file__feedback").exists()).toBe(false);
    await save.trigger("click"); await flushPromises();
    expect(wrapper.find(".artifact-file__feedback").exists()).toBe(false);
    expect(save.attributes("disabled")).toBeUndefined();
    await save.trigger("click"); await flushPromises();
    expect(wrapper.find(".artifact-file__feedback").exists()).toBe(false);
    await wrapper.setProps({ artifacts: [{ ...file, status: "expired" }] });
    expect(wrapper.find(".chat-artifact-document-card").exists()).toBe(false);
    expect(wrapper.text()).toContain("已过期");
  });

  it("uses the report save client for report cards and leaves preview to the sidebar", async () => {
    const file = report();
    const openFile = vi.fn();
    const reportNativeClient: ChatArtifactReportNativeClient = {
      readReportPreview: vi.fn(),
      saveReport: vi.fn(async () => ({ status: "failed" as const, code: "artifact_native_dialog_unavailable" as const })),
    };
    const wrapper = mount(ChatArtifactList, {
      props: { artifacts: [file], contextId: CONTEXT_ID, openFile, reportNativeClient },
    });
    await wrapper.get('button[aria-label="预览 报告.json"]').trigger("click");
    expect(openFile).toHaveBeenCalledExactlyOnceWith(file);
    await wrapper.get('button[aria-label="另存为"]').trigger("click"); await flushPromises();
    expect(reportNativeClient.saveReport).toHaveBeenCalledExactlyOnceWith(CONTEXT_ID, {
      sessionId: SESSION_ID, turnId: TURN_ID, artifactId: file.artifactId,
    });
    expect(reportNativeClient.readReportPreview).not.toHaveBeenCalled();
    expect(openFile).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".artifact-report__save-feedback").exists()).toBe(false);
  });
});
