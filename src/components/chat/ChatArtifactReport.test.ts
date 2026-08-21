// @vitest-environment happy-dom

import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineComponent } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatArtifactReportNativeClientError,
  type ChatArtifactReportNativeClient,
} from "../../api/chat-artifact-report-native-client";
import type {
  ArtifactReportPreviewResult,
  ArtifactReportSection,
} from "../../domain/chat-artifact-report-native";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactReport from "./ChatArtifactReport.vue";

const SESSION_ID = "019c1a00-0000-7000-8000-000000000901";
const TURN_ID = "019c1a00-0000-7000-8000-000000000902";
const CONTEXT_ID = "019c1a00-0000-7000-8000-000000000900";
const SECOND_CONTEXT_ID = "019c1a00-0000-7000-8000-000000000905";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000903";
const AUTHORIZED_MARKER = "AUTHORIZED-REPORT-PROJECTION";

const ChartStub = defineComponent({
  name: "YjChartCard",
  props: { model: { type: Object, required: true } },
  template: `
    <article data-testid="yj-chart-card" :data-status="model.status" :data-ordinal="model.ordinal">
      <p v-if="model.status === 'fallback'" data-testid="yj-chart-fallback">图表回落为表格</p>
      <table><caption>图表数据</caption><tbody><tr v-for="(row, index) in model.table.rows" :key="index"><td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td></tr></tbody></table>
    </article>
  `,
});

function artifact(overrides: Partial<ChatArtifact> = {}) {
  return createArtifactProjection(SESSION_ID, TURN_ID, Object.freeze({
    artifactId: ARTIFACT_ID,
    kind: "report",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "经营报告.json",
    mediaType: "application/vnd.yijie.report+json;version=1",
    sizeBytes: 2_048,
    localCommittedAt: 1_000,
    expiresAt: 605_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  }));
}

function section<T extends ArtifactReportSection>(value: T): T {
  return value;
}

function knownProjection(sections?: readonly ArtifactReportSection[]): ArtifactReportPreviewResult {
  return Object.freeze({
    schemaVersion: 1,
    title: `${AUTHORIZED_MARKER} 季度经营报告`,
    generatedAt: "2026-08-21T08:00:00Z",
    sourceTime: "2026-08-20T23:59:59Z",
    truncated: true,
    sections: sections ?? Object.freeze([
      section({ ordinal: 0, id: "duplicate", type: "summary", required: true, truncated: false, heading: "摘要", text: "经营保持稳定。" }),
      section({ ordinal: 1, id: "duplicate", type: "metrics", required: false, truncated: false, items: [{ label: "订单", value: 42, unit: "单" }] }),
      section({ ordinal: 2, id: "paragraph", type: "paragraph", required: false, truncated: true, heading: "说明", text: "仅展示有界投影。" }),
      section({ ordinal: 3, id: "table", type: "table", required: false, truncated: false, caption: "季度数据", columns: [{ ordinal: 0, key: "quarter", label: "季度" }, { ordinal: 1, key: "total", label: "总计" }], rows: [["Q1", 42], ["Q2", null], ["Q3", true]] }),
      section({ ordinal: 4, id: "callout", type: "callout", required: false, truncated: false, tone: "warning", title: "提示", text: "需要关注异常波动。" }),
      section({ ordinal: 5, id: "provider-secret-section", type: "unsupported", required: false, truncated: false }),
    ]),
  });
}

function chartSection(
  ordinal: number,
  chartType: "bar" | "line" | "pie" = "bar",
  overrides: Partial<Extract<ArtifactReportSection, { type: "chart" }>> = {},
): Extract<ArtifactReportSection, { type: "chart" }> {
  const labels = chartType === "pie" ? ["A", "B"] : ["A", "B"];
  return {
    ordinal,
    id: `chart-${ordinal}`,
    type: "chart",
    required: false,
    truncated: false,
    title: `图表 ${ordinal}`,
    chartType,
    labels,
    series: [{ ordinal: 0, name: "数值", values: [1, 2] }],
    aligned: true,
    ...overrides,
  };
}

function budgetChart(ordinal: number): Extract<ArtifactReportSection, { type: "chart" }> {
  const labels = Array.from({ length: 64 }, (_, index) => `L${index}`);
  return chartSection(ordinal, "bar", {
    labels,
    series: Array.from({ length: 8 }, (_, seriesOrdinal) => ({
      ordinal: seriesOrdinal,
      name: `S${seriesOrdinal}`,
      values: labels.map((_, index) => index + seriesOrdinal),
    })),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function client(preview: ArtifactReportPreviewResult = knownProjection()): ChatArtifactReportNativeClient {
  return {
    readReportPreview: vi.fn(async () => preview),
    saveReport: vi.fn(async () => ({ status: "saved" as const, code: null })),
  };
}

function mountReport(options: {
  projection?: ArtifactReportPreviewResult;
  nativeClient?: ChatArtifactReportNativeClient;
  contextId?: string;
  artifactOverrides?: Partial<ChatArtifact>;
  attach?: boolean;
} = {}) {
  return mount(ChatArtifactReport, {
    attachTo: options.attach ? document.body : undefined,
    props: {
      artifact: artifact(options.artifactOverrides),
      contextId: options.contextId ?? CONTEXT_ID,
      client: options.nativeClient ?? client(options.projection),
    },
    global: { stubs: { YjChartCard: ChartStub } },
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatArtifactReport", () => {
  it("fails closed for non-report, non-ready, missing client, or an untrusted context", () => {
    expect(mountReport({ artifactOverrides: { kind: "file" } }).find("[data-testid='artifact-report']").exists()).toBe(false);
    expect(mountReport({ artifactOverrides: { status: "processing", mediaType: null, sizeBytes: null, localCommittedAt: null, expiresAt: null } }).find("[data-testid='artifact-report']").exists()).toBe(false);

    const missingClient = mount(ChatArtifactReport, {
      props: { artifact: artifact(), contextId: CONTEXT_ID },
      global: { stubs: { YjChartCard: ChartStub } },
    });
    expect(missingClient.find("button").exists()).toBe(false);
    expect(missingClient.text()).toContain("暂不可用");

    const missingContext = mountReport({ contextId: "" });
    expect(missingContext.find("button").exists()).toBe(false);
    expect(missingContext.text()).toContain("暂不可用");
  });

  it("opens only on explicit intent, renders all known sections as inert content, and omits unknown details", async () => {
    const pending = deferred<ArtifactReportPreviewResult>();
    const nativeClient = client();
    vi.mocked(nativeClient.readReportPreview).mockReturnValueOnce(pending.promise);
    const wrapper = mountReport({ nativeClient, attach: true });

    expect(nativeClient.readReportPreview).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    expect(nativeClient.readReportPreview).toHaveBeenCalledWith(CONTEXT_ID, {
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      artifactId: ARTIFACT_ID,
    });
    expect(wrapper.get("[data-testid='artifact-report']").attributes("aria-busy")).toBe("true");
    expect(wrapper.text()).toContain("正在读取安全报告预览");

    pending.resolve(knownProjection());
    await flushPromises();
    expect(wrapper.text()).toContain(AUTHORIZED_MARKER);
    expect(wrapper.text()).toContain("经营保持稳定");
    expect(wrapper.text()).toContain("订单");
    expect(wrapper.text()).toContain("季度数据");
    expect(wrapper.text()).toContain("需要关注异常波动");
    expect(wrapper.text()).toContain("生成时间");
    expect(wrapper.text()).toContain("数据时间");
    expect(wrapper.text()).toContain("单位");
    expect(wrapper.text()).toContain("数据来源");
    expect(wrapper.text()).toContain("时间范围");
    expect(wrapper.text().match(/报告未提供/g)?.length).toBeGreaterThanOrEqual(3);
    expect(wrapper.text()).toContain("此可选报告区块暂不支持");
    expect(wrapper.text()).not.toContain("provider-secret-section");
    expect(wrapper.find("a, iframe, script").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get("[data-testid='artifact-report-preview-region']").element);
  });

  it("uses section ordinals despite duplicate ids and exposes global and per-section truncation", async () => {
    const wrapper = mountReport();
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();

    const ordinals = wrapper.findAll("[data-section-ordinal]").map((entry) => entry.attributes("data-section-ordinal"));
    expect(ordinals).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect(wrapper.text()).toContain("报告仅展示部分安全投影");
    expect(wrapper.get("[data-section-ordinal='2']").text()).toContain("本节仅展示部分内容");
  });

  it("applies the immutable adapter and selects only the first four ordinal charts within 2,048 points", async () => {
    const sections = Object.freeze([
      budgetChart(0), budgetChart(1), budgetChart(2), budgetChart(3), budgetChart(4),
      chartSection(5, "pie"),
      chartSection(6, "line", { aligned: false, series: [{ ordinal: 0, name: "错位", values: [1] }] }),
      chartSection(7, "bar", { labels: Array.from({ length: 65 }, (_, index) => `X${index}`), series: [{ ordinal: 0, name: "超限", values: Array.from({ length: 65 }, () => 1) }] }),
    ]);
    const projection = knownProjection(sections);
    const wrapper = mountReport({ projection });
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();

    const cards = wrapper.findAll("[data-testid='yj-chart-card']");
    expect(cards).toHaveLength(8);
    expect(cards.slice(0, 4).map((card) => card.attributes("data-status"))).toEqual(["renderable", "renderable", "renderable", "renderable"]);
    expect(cards.slice(4).every((card) => card.attributes("data-status") === "fallback")).toBe(true);
    expect(wrapper.text()).toContain("已达到安全图表增强上限");
    expect(wrapper.findAll("[data-testid='yj-chart-card'] table")).toHaveLength(8);
  });

  it("deduplicates open, drops stale responses, clears on identity changes, and retries stable errors", async () => {
    const first = deferred<ArtifactReportPreviewResult>();
    const nativeClient = client();
    vi.mocked(nativeClient.readReportPreview)
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new ChatArtifactReportNativeClientError({
        schemaVersion: 1,
        requestId: null,
        code: "artifact_native_conflict",
        retryable: true,
      }))
      .mockResolvedValueOnce(knownProjection());
    const wrapper = mountReport({ nativeClient });

    await Promise.all([
      wrapper.get("[data-testid='artifact-report-open']").trigger("click"),
      wrapper.get("[data-testid='artifact-report-open']").trigger("click"),
    ]);
    expect(nativeClient.readReportPreview).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ artifact: artifact({ artifactId: "019c1a00-0000-7000-8000-000000000904" }) });
    first.resolve(knownProjection());
    await flushPromises();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);

    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请稍后重试");
    await wrapper.get("[data-testid='artifact-report-retry']").trigger("click");
    await flushPromises();
    expect(nativeClient.readReportPreview).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain(AUTHORIZED_MARKER);

    await wrapper.setProps({ contextId: SECOND_CONTEXT_ID });
    await flushPromises();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(AUTHORIZED_MARKER);

    await wrapper.setProps({ artifact: Object.freeze({
      ...artifact({ artifactId: "019c1a00-0000-7000-8000-000000000904" }),
      sessionId: "019c1a00-0000-7000-8000-000000000906",
    }) });
    await flushPromises();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
  });

  it("deduplicates canonical JSON save and renders only content-free saved, cancelled, and failed feedback", async () => {
    const nativeClient = client();
    const pending = deferred<{ status: "saved"; code: null }>();
    vi.mocked(nativeClient.saveReport)
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ status: "cancelled", code: null })
      .mockResolvedValueOnce({ status: "failed", code: "artifact_native_permission_denied" });
    const wrapper = mountReport({ nativeClient });

    await Promise.all([
      wrapper.get("[data-testid='artifact-report-save']").trigger("click"),
      wrapper.get("[data-testid='artifact-report-save']").trigger("click"),
    ]);
    expect(nativeClient.saveReport).toHaveBeenCalledTimes(1);
    pending.resolve({ status: "saved", code: null });
    await flushPromises();
    expect(wrapper.text()).toContain("报告 JSON 已保存");

    await wrapper.get("[data-testid='artifact-report-save']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已取消保存");
    await wrapper.get("[data-testid='artifact-report-save']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("没有权限保存报告");
    expect(wrapper.text()).not.toMatch(/(?:requestId|native error|\/Users\/|[A-Fa-f0-9]{64})/);
  });

  it("keeps native save single-flight while closing a preview and drops the stale save feedback", async () => {
    const nativeClient = client();
    const pending = deferred<{ status: "saved"; code: null }>();
    vi.mocked(nativeClient.saveReport).mockReturnValueOnce(pending.promise);
    const wrapper = mountReport({ nativeClient });
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    await wrapper.get("[data-testid='artifact-report-save']").trigger("click");
    await wrapper.get("[data-testid='artifact-report-close']").trigger("click");
    await wrapper.get("[data-testid='artifact-report-save']").trigger("click");
    expect(nativeClient.saveReport).toHaveBeenCalledTimes(1);

    pending.resolve({ status: "saved", code: null });
    await flushPromises();
    expect(wrapper.text()).not.toContain("报告 JSON 已保存");
    expect(wrapper.get("[data-testid='artifact-report-save']").attributes("disabled")).toBeUndefined();
  });

  it("clears authorized content and feedback on close/unmount and preserves focus, axe, and source safety", async () => {
    const consoleSpies = [
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    const wrapper = mountReport({
      attach: true,
      projection: knownProjection(Object.freeze([chartSection(0, "bar")])),
    });
    const trigger = wrapper.get("[data-testid='artifact-report-open']").element;
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(AUTHORIZED_MARKER);
    expect(wrapper.find("[data-testid='yj-chart-card']").exists()).toBe(true);
    expect((await axe.run(wrapper.element)).violations).toEqual([]);

    await wrapper.get("[data-testid='artifact-report-close']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
    expect(wrapper.find("[data-testid='yj-chart-card']").exists()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);

    const source = readFileSync(resolve(process.cwd(), "src/components/chat/ChatArtifactReport.vue"), "utf8");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toMatch(/v-html|\binvoke\s*\(|\bfetch\s*\(|localStorage|sessionStorage|indexedDB|\bconsole\.|useRouter|defineStore/);
    await wrapper.get("[data-testid='artifact-report-open']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(AUTHORIZED_MARKER);
    wrapper.unmount();
    expect(document.body.textContent).not.toContain(AUTHORIZED_MARKER);
  });
});
