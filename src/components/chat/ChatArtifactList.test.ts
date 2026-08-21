// @vitest-environment happy-dom

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { ChatArtifactReportNativeClient } from "../../api/chat-artifact-report-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactList from "./ChatArtifactList.vue";

const SESSION_ID = "019c1a00-0000-7000-8000-000000000911";
const TURN_ID = "019c1a00-0000-7000-8000-000000000912";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000910";

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
