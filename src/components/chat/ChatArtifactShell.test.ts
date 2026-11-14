// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ChatArtifactFileNativeClient } from "../../api/chat-artifact-file-native-client";
import type { ChatArtifactNativeClient } from "../../api/chat-artifact-native-client";
import type { ChatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactList from "./ChatArtifactList.vue";
import ChatArtifactShell from "./ChatArtifactShell.vue";

vi.mock("naive-ui", async original => ({
  ...await original<typeof import("naive-ui")>(),
  useMessage: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const SESSION_ID = "019c1a00-0000-7000-8000-000000000301";
const TURN_ID = "019c1a00-0000-7000-8000-000000000302";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000300";
const PREVIEW_URL = `yijie-artifact-preview://localhost/v1/${"D".repeat(43)}`;
const NATIVE_CLIENT: ChatArtifactNativeClient = {
  openImagePreview: vi.fn(async () => ({ status: "opened" as const, previewUrl: PREVIEW_URL })),
  releaseImagePreview: vi.fn(async () => ({ status: "released" as const })),
  saveImage: vi.fn(async () => ({ status: "saved" as const, code: null })),
  copyImage: vi.fn(async () => ({ status: "copied" as const })),
};
const FILE_NATIVE_CLIENT: ChatArtifactFileNativeClient = {
  readFilePreview: vi.fn(async () => ({
    status: "previewed" as const,
    mediaType: "text/plain" as const,
    text: "显式打开后的安全内容",
    truncated: false,
  })),
  saveFile: vi.fn(async () => ({ status: "saved" as const, code: null })),
};
const REPORT_NATIVE_CLIENT: ChatArtifactReportNativeClient = {
  readReportPreview: vi.fn(async () => ({
    schemaVersion: 1 as const,
    title: "安全结构化报告",
    generatedAt: "2026-08-21T08:00:00Z",
    sourceTime: null,
    truncated: false,
    sections: [],
  })),
  saveReport: vi.fn(async () => ({ status: "saved" as const, code: null })),
};

function artifact(
  ordinal: number,
  overrides: Partial<ChatArtifact> = {},
) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: `019c1a00-0000-7000-8000-0000000003${String(ordinal + 3).padStart(2, "0")}`,
    kind: "image",
    provenance: "synthetic",
    status: "announced",
    ordinal,
    progressStage: null,
    progressPercent: null,
    displayName: null,
    mediaType: null,
    sizeBytes: null,
    localCommittedAt: null,
    expiresAt: null,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  }));
}

describe("ChatArtifactShell", () => {
  it("keeps provider video delivery failures on the original task without offering regeneration", () => {
    for (const retryable of [true, false]) {
      const wrapper = mount(ChatArtifactShell, { props: {
        artifact: artifact(0, {kind: "video", provenance: "provider", status: "failed", errorCode: "resource_unavailable", retryable}),
        contextId: CONTEXT_ID,
      }});
      try {
        expect(wrapper.get("[data-testid='artifact-failure-guidance']").text()).toContain("查询原视频任务");
        expect(wrapper.text()).toContain("重新生成会创建新任务");
        expect(wrapper.text()).not.toContain("重新提交需求");
        expect(wrapper.find("video").exists()).toBe(false);
        expect(wrapper.findAll("button")).toHaveLength(0);
      } finally { wrapper.unmount(); }
    }
  });
  it("routes document and media previews through their respective artifact bindings", async () => {
    const openFile = vi.fn();
    const value = artifact(0, {kind:"file",status:"ready",mediaType:"application/pdf",displayName:"normal.pdf"});
    const wrapper = mount(ChatArtifactList, {props:{artifacts:[value],contextId:CONTEXT_ID,openFile,nativeClient:NATIVE_CLIENT,fileNativeClient:FILE_NATIVE_CLIENT}});
    try {
      await wrapper.get('[aria-label="预览 normal.pdf"]').trigger("click");
      expect(openFile).toHaveBeenCalledExactlyOnceWith(value);
      await wrapper.get('[aria-label="另存为"]').trigger("click");
      expect(FILE_NATIVE_CLIENT.saveFile).toHaveBeenCalled();
      const image = artifact(0, {kind:"image",status:"ready",mediaType:"image/png",displayName:"图.png"});
      await wrapper.setProps({artifacts:[image]});
      expect(wrapper.get(".artifact-image__title").text()).toBe("图");
      expect(wrapper.find(".artifact-shell").exists()).toBe(false);
      const video = artifact(0, {kind:"video",status:"ready",mediaType:"video/mp4",displayName:"演示.mp4"});
      await wrapper.setProps({artifacts:[video]});
      expect(wrapper.get('[aria-label="播放视频：演示.mp4"]').attributes("aria-haspopup")).toBe("dialog");
      expect(wrapper.find(".artifact-shell").exists()).toBe(false);
      expect(wrapper.text()).not.toMatch(/MP4|已就绪|本地合成演示/);
      expect(openFile).toHaveBeenCalledTimes(1);
    } finally {wrapper.unmount();}
  });
  it("renders safe metadata, all generic states, four kinds, and synthetic provenance", () => {
    const items = [
      artifact(0, { kind: "file", status: "announced", displayName: "demo.txt" }),
      artifact(1, { kind: "video", status: "generating", progressStage: "generating" }),
      artifact(2, { kind: "file", status: "processing", progressStage: "processing", progressPercent: 42 }),
      artifact(3, { kind: "report", status: "transferring", mediaType: "application/vnd.yijie.report+json;version=1", sizeBytes: 32 }),
      artifact(4, { kind: "file", status: "ready", mediaType: "text/plain", sizeBytes: 32, localCommittedAt: 1_000, expiresAt: 605_801_000 }),
      artifact(5, { kind: "file", status: "failed", errorCode: "artifact_failed", retryable: false }),
      artifact(6, { kind: "file", status: "cancelled", errorCode: "turn_interrupted", retryable: false }),
      artifact(7, { kind: "file", status: "expired", mediaType: "image/png", sizeBytes: 32, localCommittedAt: 1_000, expiresAt: 605_801_000 }),
    ];
    const wrapper = mount(ChatArtifactList, {
      props: { artifacts: items, contextId: CONTEXT_ID, nativeClient: NATIVE_CLIENT },
    });

    expect(wrapper.text()).toContain("demo.txt");
    expect(wrapper.text()).toContain("视频");
    expect(wrapper.text()).toContain("文件");
    expect(wrapper.text()).toContain("报告");
    expect(wrapper.text()).toContain("本地合成演示");
    for (const label of ["已登记", "正在生成", "正在处理", "正在安全传输", "已就绪", "失败", "已取消", "已过期"]) {
      expect(wrapper.text()).toContain(label);
    }
    expect(wrapper.findAll("article")).toHaveLength(8);
  });

  it("exposes busy, live, focus, and trusted progress semantics without inventing a percent", () => {
    const unknown = mount(ChatArtifactShell, {
      props: {
        artifact: artifact(0, { kind: "file", status: "generating", progressStage: "generating" }),
        contextId: CONTEXT_ID,
        nativeClient: NATIVE_CLIENT,
      },
    });
    expect(unknown.get("article").attributes("aria-busy")).toBe("true");
    expect(unknown.get("article").attributes("tabindex")).toBe("0");
    expect(unknown.get("[aria-live='polite']").text()).toContain("正在生成");
    expect(unknown.find("[role='progressbar']").exists()).toBe(false);
    expect(unknown.text()).not.toContain("0%");

    const trusted = mount(ChatArtifactShell, {
      props: {
        artifact: artifact(1, {
          kind: "file",
          status: "processing",
          progressStage: "processing",
          progressPercent: 57,
        }),
        contextId: CONTEXT_ID,
        nativeClient: NATIVE_CLIENT,
      },
    });
    const progress = trusted.get("[role='progressbar']");
    expect(progress.attributes("aria-valuemin")).toBe("0");
    expect(progress.attributes("aria-valuemax")).toBe("100");
    expect(progress.attributes("aria-valuenow")).toBe("57");
    expect(trusted.text()).toContain("57%");
    expect(trusted.get("[aria-live='polite']").text()).not.toContain("57%");
  });

  it("shows safe failed-generation recovery without exposing provider error details", async () => {
    const retryable = mount(ChatArtifactShell, {
      attachTo: document.body,
      props: {
        artifact: artifact(0, {
          provenance: "provider",
          status: "failed",
          errorCode: "provider_raw_/Users/demo/minimax.key_bearer",
          retryable: true,
        }),
        contextId: CONTEXT_ID,
      },
    });
    expect(retryable.text()).not.toContain("服务生成");
    expect(retryable.get("[role='alert'] span").text())
      .toBe("图片生成失败，可在输入框重新提交需求。");
    expect(retryable.html()).not.toMatch(/(?:\/Users\/|minimax\.key|bearer|provider_raw)/i);
    expect((await axe.run(retryable.element)).violations).toEqual([]);
    retryable.unmount();

    const terminal = mount(ChatArtifactShell, {
      props: {
        artifact: artifact(1, {
          status: "failed",
          errorCode: "artifact_request_invalid",
          retryable: false,
        }),
        contextId: CONTEXT_ID,
      },
    });
    expect(terminal.get("[role='alert'] span").text())
      .toBe("图片生成失败，请调整需求后重新提交。");
  });

  it("escapes the safe name and keeps the image action surface metadata-only", async () => {
    const wrapper = mount(ChatArtifactList, {
      attachTo: document.body,
      props: {
        contextId: CONTEXT_ID,
        nativeClient: NATIVE_CLIENT,
        artifacts: [artifact(0, {
          status: "ready",
          displayName: "<img onerror=alert(1)>.png",
          mediaType: "image/png",
          sizeBytes: 32,
          localCommittedAt: 1_000,
          expiresAt: 605_801_000,
        })],
      },
    });
    await flushPromises();

    expect(wrapper.find("img").exists()).toBe(true);
    expect(wrapper.find("video, audio, iframe, a").exists()).toBe(false);
    expect(wrapper.findAll("button").length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("<img onerror=alert(1)>.png");
    expect(wrapper.html()).not.toMatch(/(?:base64|digest|hostHref|absolutePath|token|v-html)/i);
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    wrapper.unmount();
  });

  it("adds file actions only for a ready file and forwards the trusted context to S8A", async () => {
    const wrapper = mount(ChatArtifactShell, {
      props: {
        artifact: artifact(8, {
          kind: "file",
          status: "ready",
          displayName: "安全文件.txt",
          mediaType: "text/plain",
          sizeBytes: 32,
          localCommittedAt: 1_000,
          expiresAt: 605_801_000,
        }),
        contextId: CONTEXT_ID,
        fileNativeClient: FILE_NATIVE_CLIENT,
      },
    });

    expect(FILE_NATIVE_CLIENT.readFilePreview).not.toHaveBeenCalled();
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect(FILE_NATIVE_CLIENT.readFilePreview).toHaveBeenCalledWith(CONTEXT_ID, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: "019c1a00-0000-7000-8000-000000000311",
    });
    expect(wrapper.text()).toContain("显式打开后的安全内容");

    await wrapper.setProps({ artifact: artifact(8, { kind: "file", status: "expired" }) });
    await flushPromises();
    expect(wrapper.find("[data-testid='artifact-file']").exists()).toBe(false);
  });

  it("adds report actions only for a ready report and forwards the trusted context to S9A", async () => {
    const wrapper = mount(ChatArtifactShell, {
      props: {
        artifact: artifact(9, {
          kind: "report",
          status: "ready",
          displayName: "安全报告.json",
          mediaType: "application/vnd.yijie.report+json;version=1",
          sizeBytes: 128,
          localCommittedAt: 1_000,
          expiresAt: 605_801_000,
        }),
        contextId: CONTEXT_ID,
        reportNativeClient: REPORT_NATIVE_CLIENT,
      },
    });

    expect(REPORT_NATIVE_CLIENT.readReportPreview).not.toHaveBeenCalled();
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(REPORT_NATIVE_CLIENT.readReportPreview).toHaveBeenCalledWith(CONTEXT_ID, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: "019c1a00-0000-7000-8000-000000000312",
    });
    expect(wrapper.text()).toContain("安全结构化报告");

    await wrapper.setProps({ artifact: artifact(9, { kind: "report", status: "failed" }) });
    await flushPromises();
    expect(wrapper.find("[data-testid='artifact-report']").exists()).toBe(false);
  });
});
