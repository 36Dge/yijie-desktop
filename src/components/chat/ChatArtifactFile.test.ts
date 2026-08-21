// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import axe from "axe-core";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChatArtifactFileNativeClientError,
  type ChatArtifactFileNativeClient,
} from "../../api/chat-artifact-file-native-client";
import type { ChatArtifact } from "../../domain/chat-ipc";
import { createArtifactProjection } from "../../domain/chat-artifact";
import ChatArtifactFile from "./ChatArtifactFile.vue";

const CONTEXT_A = "019c1a00-0000-7000-8000-000000000601";
const CONTEXT_B = "019c1a00-0000-7000-8000-000000000602";
const SESSION_ID = "019c1a00-0000-7000-8000-000000000603";
const SESSION_B = "019c1a00-0000-7000-8000-000000000607";
const TURN_ID = "019c1a00-0000-7000-8000-000000000604";
const ARTIFACT_ID = "019c1a00-0000-7000-8000-000000000605";
const ARTIFACT_B = "019c1a00-0000-7000-8000-000000000606";
const AUTHORIZED_MARKER = "S8B_AUTHORIZED_PREVIEW_MARKER";

function artifact(
  overrides: Partial<ChatArtifact> = {},
  scope: Readonly<{ sessionId: string; turnId: string }> = { sessionId: SESSION_ID, turnId: TURN_ID },
) {
  return createArtifactProjection(scope.sessionId, scope.turnId, Object.freeze({
    artifactId: ARTIFACT_ID,
    kind: "file",
    provenance: "synthetic",
    status: "ready",
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: "安全文件.txt",
    mediaType: "text/plain",
    sizeBytes: 48,
    localCommittedAt: 1_000,
    expiresAt: 605_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
    ...overrides,
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nativeClient(): ChatArtifactFileNativeClient {
  return {
    readFilePreview: vi.fn(async () => ({
      status: "previewed" as const,
      mediaType: "text/plain" as const,
      text: AUTHORIZED_MARKER,
      truncated: false,
    })),
    saveFile: vi.fn(async () => ({ status: "saved" as const, code: null })),
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ChatArtifactFile", () => {
  it("fails closed for non-file and non-ready Artifacts without reading content", async () => {
    const client = nativeClient();
    const image = mount(ChatArtifactFile, {
      props: { artifact: artifact({ kind: "image", mediaType: "image/png" }), contextId: CONTEXT_A, client },
    });
    const announced = mount(ChatArtifactFile, {
      props: {
        artifact: artifact({ status: "announced", mediaType: null, sizeBytes: null, localCommittedAt: null, expiresAt: null }),
        contextId: CONTEXT_A,
        client,
      },
    });
    await flushPromises();

    expect(image.find("[data-testid='artifact-file']").exists()).toBe(false);
    expect(announced.find("[data-testid='artifact-file']").exists()).toBe(false);
    expect(client.readFilePreview).not.toHaveBeenCalled();
    expect(client.saveFile).not.toHaveBeenCalled();
  });

  it("opens only after explicit intent, deduplicates loading, and renders inert plain text", async () => {
    const pending = deferred<{
      status: "previewed";
      mediaType: "text/plain";
      text: string;
      truncated: false;
    }>();
    const client = nativeClient();
    vi.mocked(client.readFilePreview).mockImplementationOnce(async () => pending.promise);
    const wrapper = mount(ChatArtifactFile, {
      attachTo: document.body,
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });

    expect(client.readFilePreview).not.toHaveBeenCalled();
    const open = wrapper.get<HTMLButtonElement>("[data-testid='artifact-file-open']");
    open.element.focus();
    await open.trigger("click");
    await open.trigger("click");
    expect(client.readFilePreview).toHaveBeenCalledTimes(1);
    expect(wrapper.get("[data-testid='artifact-file']").attributes("aria-busy")).toBe("true");

    pending.resolve({
      status: "previewed",
      mediaType: "text/plain",
      text: `${AUTHORIZED_MARKER}\n<script>unsafe()</script>\nhttps://example.invalid\n=CMD()`,
      truncated: false,
    });
    await flushPromises();

    const region = wrapper.get<HTMLElement>("[data-testid='artifact-file-preview-region']");
    expect(region.element).toBe(document.activeElement);
    expect(region.get("pre").text()).toContain("<script>unsafe()</script>");
    expect(region.find("script, a, iframe, form").exists()).toBe(false);
    expect(wrapper.get("[data-testid='artifact-file']").attributes("aria-busy")).toBe("false");
    wrapper.unmount();
  });

  it("renders JSON as plain text and CSV as an accessible text-only table", async () => {
    const jsonClient = nativeClient();
    vi.mocked(jsonClient.readFilePreview).mockResolvedValueOnce({
      status: "previewed",
      mediaType: "application/json",
      text: "{\"url\":\"https://example.invalid\",\"html\":\"<b>plain</b>\"}",
      truncated: false,
    });
    const json = mount(ChatArtifactFile, {
      props: { artifact: artifact({ mediaType: "application/json", displayName: "safe.json" }), contextId: CONTEXT_A, client: jsonClient },
    });
    await json.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect(json.get("pre").text()).toContain("<b>plain</b>");
    expect(json.find("a, b, script").exists()).toBe(false);

    const csvClient = nativeClient();
    vi.mocked(csvClient.readFilePreview).mockResolvedValueOnce({
      status: "previewed",
      mediaType: "text/csv",
      rows: [["name", "value"], ["formula", "=HYPERLINK(\"https://example.invalid\")"]],
      truncated: false,
    });
    const csv = mount(ChatArtifactFile, {
      props: { artifact: artifact({ mediaType: "text/csv", displayName: "safe.csv" }), contextId: CONTEXT_A, client: csvClient },
    });
    await csv.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect(csv.get("table").attributes("aria-label")).toContain("safe.csv");
    expect(csv.findAll("tbody tr")).toHaveLength(1);
    expect(csv.get("table").text()).toContain("=HYPERLINK");
    expect(csv.find("a, script").exists()).toBe(false);
  });

  it("keeps PDF and XLSX metadata-only with native save fallback", async () => {
    for (const mediaType of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]) {
      const client = nativeClient();
      const wrapper = mount(ChatArtifactFile, {
        props: { artifact: artifact({ mediaType }), contextId: CONTEXT_A, client },
      });
      expect(wrapper.text()).toContain("不支持应用内预览");
      expect(wrapper.find("[data-testid='artifact-file-open']").exists()).toBe(false);
      expect(wrapper.find("pre, table, iframe, object, embed").exists()).toBe(false);
      await wrapper.get("[data-testid='artifact-file-save']").trigger("click");
      await flushPromises();
      expect(client.readFilePreview).not.toHaveBeenCalled();
      expect(client.saveFile).toHaveBeenCalledTimes(1);
      wrapper.unmount();
    }
  });

  it("performs bounded case-sensitive literal search over text without regex semantics", async () => {
    const client = nativeClient();
    vi.mocked(client.readFilePreview).mockResolvedValueOnce({
      status: "previewed",
      mediaType: "text/plain",
      text: `${Array.from({ length: 120 }, () => "a.b").join(" ")} axb`,
      truncated: true,
    });
    const wrapper = mount(ChatArtifactFile, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();

    const input = wrapper.get<HTMLInputElement>("[data-testid='artifact-file-search']");
    await input.setValue("a.b");
    expect(wrapper.findAll("mark")).toHaveLength(100);
    expect(wrapper.get("[data-testid='artifact-file-search-status']").text()).toContain("100");
    expect(wrapper.get("[data-testid='artifact-file-truncated']").text()).toContain("截断区未搜索");

    await input.setValue("A.B");
    expect(wrapper.findAll("mark")).toHaveLength(0);
    await input.setValue(`${"😀".repeat(128)}X`);
    expect(Array.from(input.element.value)).toHaveLength(128);
  });

  it("searches CSV cells only and caps total hits at 100", async () => {
    const client = nativeClient();
    vi.mocked(client.readFilePreview).mockResolvedValueOnce({
      status: "previewed",
      mediaType: "text/csv",
      rows: Array.from({ length: 60 }, () => ["hit hit", "miss"]),
      truncated: false,
    });
    const wrapper = mount(ChatArtifactFile, {
      props: { artifact: artifact({ mediaType: "text/csv" }), contextId: CONTEXT_A, client },
    });
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    await wrapper.get<HTMLInputElement>("[data-testid='artifact-file-search']").setValue("hit");
    expect(wrapper.findAll("mark")).toHaveLength(100);
    expect(wrapper.get("[data-testid='artifact-file-search-status']").text()).toContain("100");
  });

  it("clears content and search on close, identity/context changes, stale response, and unmount", async () => {
    const first = deferred<{
      status: "previewed";
      mediaType: "text/plain";
      text: string;
      truncated: false;
    }>();
    const client = nativeClient();
    vi.mocked(client.readFilePreview)
      .mockImplementationOnce(async () => first.promise)
      .mockResolvedValueOnce({ status: "previewed", mediaType: "text/plain", text: "CURRENT", truncated: false });
    const wrapper = mount(ChatArtifactFile, {
      attachTo: document.body,
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    await wrapper.setProps({ contextId: CONTEXT_B, artifact: artifact({ artifactId: ARTIFACT_B }) });
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    first.resolve({ status: "previewed", mediaType: "text/plain", text: "STALE_SECRET", truncated: false });
    await flushPromises();
    expect(wrapper.text()).toContain("CURRENT");
    expect(wrapper.text()).not.toContain("STALE_SECRET");

    await wrapper.get<HTMLInputElement>("[data-testid='artifact-file-search']").setValue("CUR");
    const close = wrapper.get<HTMLButtonElement>("[data-testid='artifact-file-close']");
    await close.trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain("CURRENT");
    expect(wrapper.find("[data-testid='artifact-file-search']").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get("[data-testid='artifact-file-open']").element);

    wrapper.unmount();
    expect(document.body.textContent).not.toContain(AUTHORIZED_MARKER);
  });

  it("clears an open projection for status, artifact, session, and context switches", async () => {
    const changes = [
      { contextId: CONTEXT_B, artifact: artifact() },
      { contextId: CONTEXT_A, artifact: artifact({ artifactId: ARTIFACT_B }) },
      { contextId: CONTEXT_A, artifact: artifact({ status: "expired" }) },
      { contextId: CONTEXT_A, artifact: artifact({}, { sessionId: SESSION_B, turnId: TURN_ID }) },
    ];

    for (const change of changes) {
      const wrapper = mount(ChatArtifactFile, {
        props: { artifact: artifact(), contextId: CONTEXT_A, client: nativeClient() },
      });
      await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
      await flushPromises();
      expect(wrapper.text()).toContain(AUTHORIZED_MARKER);
      await wrapper.setProps(change);
      await flushPromises();
      expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
      expect(wrapper.find("[data-testid='artifact-file-search']").exists()).toBe(false);
      wrapper.unmount();
    }
  });

  it("maps expired/error states safely and retries without raw native details", async () => {
    const expiredClient = nativeClient();
    vi.mocked(expiredClient.readFilePreview).mockRejectedValueOnce(new ChatArtifactFileNativeClientError({
      schemaVersion: 1,
      requestId: null,
      code: "artifact_native_expired",
      retryable: false,
    }));
    const expired = mount(ChatArtifactFile, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client: expiredClient },
    });
    await expired.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect(expired.get("[role='alert']").text()).toContain("已过期");
    expect(expired.find("[data-testid='artifact-file-retry']").exists()).toBe(false);

    const retried = deferred<{
      status: "previewed";
      mediaType: "text/plain";
      text: string;
      truncated: false;
    }>();
    const retryClient = nativeClient();
    vi.mocked(retryClient.readFilePreview)
      .mockRejectedValueOnce(new Error("/Users/alice/private.txt token=secret"))
      .mockImplementationOnce(async () => retried.promise);
    const retryable = mount(ChatArtifactFile, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client: retryClient },
    });
    await retryable.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect(retryable.get("[role='alert']").text()).toContain("暂时无法预览");
    expect(retryable.text()).not.toMatch(/Users|private\.txt|token=secret/);
    const retry = retryable.get("[data-testid='artifact-file-retry']");
    await retry.trigger("click");
    await retry.trigger("click");
    expect(retryClient.readFilePreview).toHaveBeenCalledTimes(2);
    retried.resolve({ status: "previewed", mediaType: "text/plain", text: "SAFE", truncated: false });
    await flushPromises();
    expect(retryable.text()).toContain("SAFE");
  });

  it("deduplicates native save and exposes only content-free outcomes", async () => {
    const pending = deferred<{ status: "saved"; code: null }>();
    const client = nativeClient();
    vi.mocked(client.saveFile).mockImplementationOnce(async () => pending.promise);
    const wrapper = mount(ChatArtifactFile, {
      props: { artifact: artifact(), contextId: CONTEXT_A, client },
    });
    const save = wrapper.get("[data-testid='artifact-file-save']");
    await save.trigger("click");
    await save.trigger("click");
    expect(client.saveFile).toHaveBeenCalledTimes(1);
    pending.resolve({ status: "saved", code: null });
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-file-feedback']").text()).toContain("已保存");

    vi.mocked(client.saveFile).mockResolvedValueOnce({ status: "cancelled", code: null });
    await save.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-file-feedback']").text()).toContain("已取消");

    vi.mocked(client.saveFile).mockResolvedValueOnce({ status: "failed", code: "artifact_native_storage_full" });
    await save.trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid='artifact-file-feedback']").text()).toContain("存储空间不足");
    expect(wrapper.text()).not.toMatch(/(?:requestId|\/Users\/|digest|base64|bearer|token|raw native)/i);
  });

  it("is keyboard and axe accessible with an explicit reduced-motion and no-persistence boundary", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wrapper = mount(ChatArtifactFile, {
      attachTo: document.body,
      props: { artifact: artifact(), contextId: CONTEXT_A, client: nativeClient() },
    });
    await wrapper.get("[data-testid='artifact-file-open']").trigger("click");
    await flushPromises();
    expect((await axe.run(wrapper.element)).violations).toEqual([]);
    expect(consoleSpy).not.toHaveBeenCalled();
    const source = readFileSync("src/components/chat/ChatArtifactFile.vue", "utf8");
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
    expect(source).not.toMatch(/v-html|console\.|\.fetch\(|localStorage|sessionStorage|indexedDB|router|useArtifactStore/);
    expect(source).not.toContain("toMatchSnapshot");
    await wrapper.get("[data-testid='artifact-file-close']").trigger("click");
    await flushPromises();
    expect(wrapper.text()).not.toContain(AUTHORIZED_MARKER);
    wrapper.unmount();
  });
});
