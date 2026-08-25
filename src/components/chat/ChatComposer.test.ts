// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChatAttachment,
  ChatAttachmentImportEvent,
  ChatProject,
} from "../../domain/chat-ipc";
import ChatComposer from "./ChatComposer.vue";

const PROJECT: ChatProject = {
  projectId: "019c1a00-0000-7000-8000-000000000001",
  safeName: "Synthetic Project",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
};

const READY_FILE: ChatAttachment = {
  attachmentId: "019c1a00-0000-7000-8000-000000000002",
  type: "file",
  name: "synthetic-spec.pdf",
  mediaType: "application/pdf",
  sizeBytes: 2048,
  status: "ready",
  expiresAt: 2_000_000_000,
};

function importEvent(
  stage: ChatAttachmentImportEvent["stage"],
  overrides: Partial<ChatAttachmentImportEvent> = {},
): ChatAttachmentImportEvent {
  return {
    schemaVersion: 2,
    contextId: "019c1a00-0000-7000-8000-000000000003",
    operationId: "019c1a00-0000-7000-8000-000000000004",
    sequence: "1",
    stage,
    itemCount: 2,
    issue: stage === "error_terminal" ? "parse_failed" : null,
    ...overrides,
  };
}

function mountComposer(overrides: Record<string, unknown> = {}) {
  return mount(ChatComposer, {
    props: {
      modelValue: "检查商品标题",
      mode: "new",
      projects: [PROJECT],
      selectedProjectId: PROJECT.projectId,
      readiness: { title: "本地运行环境已就绪", detail: "只读", actionLabel: null, tone: "success" },
      canSend: true,
      canAttach: true,
      sending: false,
      streaming: false,
      recoveryAvailable: false,
      ...overrides,
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ChatComposer", () => {
  it("renders the project strip and keeps permission and send actions inside the input panel", async () => {
    const wrapper = mountComposer();
    const projectButton = wrapper.get(".chat-composer__project--button");
    expect(projectButton.text()).toBe("Synthetic Project");
    expect(projectButton.attributes("aria-label")).toBe("更换项目，当前项目 Synthetic Project");
    await projectButton.trigger("click");
    expect(wrapper.emitted("pick-project")).toHaveLength(1);

    expect(wrapper.get(".chat-composer__field").find(".chat-composer__permission").exists()).toBe(true);
    const addButton = wrapper.get('[aria-label="添加图片或文件"]');
    expect(addButton.element.nextElementSibling).toBe(wrapper.get(".chat-composer__permission").element);
    expect(addButton.attributes("title")).toBe("添加图片或文件");
    await addButton.trigger("click");
    expect(wrapper.emitted("pick-attachments")).toHaveLength(1);
    expect(wrapper.find('[aria-label="发送任务"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("权限审批");
    expect(wrapper.text()).toContain("只读 · 禁止写入");
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.find(".chat-composer__readiness").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("本地运行环境已就绪");
    expect(wrapper.text()).not.toContain("65536 字节");
    expect(wrapper.text()).not.toContain("Enter 发送");
    expect(wrapper.text()).not.toMatch(/模型选择|推理强度|语音|附件/);
  });

  it("FEAT-130 applies the refined new-task radius, contrast, and borderless hover tokens", () => {
    const source = readFileSync("src/components/chat/ChatComposer.vue", "utf8");
    expect(source).toContain(`.chat-composer--new .chat-composer__project {
  border-radius: var(--yj-radius-lg);
  background: var(--yj-color-bg-app);
}`);
    expect(source).toContain(`.chat-composer__project--button:hover:not(:disabled) {
  background: var(--yj-color-brand-soft);
}`);
  });

  it("submits with Enter, keeps Shift+Enter for a newline, and never submits while composing", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.trigger("compositionstart");
    const composingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    textarea.element.dispatchEvent(composingEnter);
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(composingEnter.defaultPrevented).toBe(false);
    await textarea.trigger("compositionend");

    const browserComposingEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.element.dispatchEvent(browserComposingEnter);
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(browserComposingEnter.defaultPrevented).toBe(false);

    const shiftEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.element.dispatchEvent(shiftEnter);
    expect(wrapper.emitted("submit")).toBeUndefined();
    expect(shiftEnter.defaultPrevented).toBe(false);

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    textarea.element.dispatchEvent(enter);
    expect(wrapper.emitted("submit")).toHaveLength(1);
    expect(enter.defaultPrevented).toBe(true);
  });

  it("disables send for blank input, missing project, unavailable readiness and active turn", async () => {
    expect(mountComposer({ modelValue: "" }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ selectedProjectId: null }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ canSend: false }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ streaming: true }).find('[aria-label="停止生成"]').exists()).toBe(true);
  });

  it("routes file paste to the unified entry without exposing clipboard metadata", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", {
      clipboardData: { files: [{ name: "private.png" }], items: [{ kind: "file" }] },
    });
    const events = wrapper.emitted("unsupported-input") ?? [];
    expect(events).toEqual([["请使用加号或拖拽添加图片与文件"]]);
    expect(JSON.stringify(events)).not.toContain("private.png");
  });

  it("allows attachment-only send and exposes terminal recovery through remove and reselect", async () => {
    const terminal = { ...READY_FILE, status: "error_terminal" as const };
    const wrapper = mountComposer({ modelValue: "", attachments: [terminal], dragActive: true });
    expect(wrapper.text()).toContain("synthetic-spec.pdf");
    expect(wrapper.text()).toContain("无法读取，请移除后重新选择");
    expect(wrapper.get(".chat-composer__drop-overlay").text()).toBe("松开以添加图片或文件");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[aria-label="重试 synthetic-spec.pdf"]').exists()).toBe(false);
    await wrapper.get('[aria-label="移除 synthetic-spec.pdf"]').trigger("click");
    expect(wrapper.emitted("remove-attachment")).toEqual([[READY_FILE.attachmentId]]);

    await wrapper.setProps({ attachments: [READY_FILE], dragActive: false });
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeUndefined();
  });

  it("renders native per-item import stages and exposes removal only for a terminal item", async () => {
    const wrapper = mountComposer({
      attachmentImporting: true,
      attachmentImportAttempt: importEvent("parsing"),
    });

    expect(wrapper.text()).toContain("2 个附件");
    expect(wrapper.text()).toContain("2 个附件 · 正在解析");
    expect(wrapper.find('[aria-label="移除失败的附件选择"]').exists()).toBe(false);
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();

    await wrapper.setProps({
      attachmentImporting: false,
      attachmentImportAttempt: importEvent("error_terminal", { sequence: "2" }),
      modelValue: "即使仍有文本也不能发送",
    });
    expect(wrapper.text()).toContain("无法读取，请移除后重新选择");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[aria-label="移除失败的附件选择"]').trigger("click");
    expect(wrapper.emitted("dismiss-attachment-import")).toEqual([
      ["019c1a00-0000-7000-8000-000000000004"],
    ]);
  });

  it("disables the unified entry and hides drag feedback when sending is unavailable", () => {
    const wrapper = mountComposer({ canSend: false, dragActive: true });
    expect(wrapper.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find(".chat-composer__drop-overlay").exists()).toBe(false);
    expect(wrapper.find(".chat-composer__field--drag-active").exists()).toBe(false);

    const attachmentBlocked = mountComposer({ canAttach: false, dragActive: true });
    expect(attachmentBlocked.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
    expect(attachmentBlocked.find(".chat-composer__drop-overlay").exists()).toBe(false);

    for (const props of [
      { sending: true },
      { streaming: true },
      { attachmentImporting: true },
      { attachments: Array.from({ length: 10 }, (_, index) => ({
        ...READY_FILE,
        attachmentId: `019c1a00-0000-7000-8000-0000000000${String(20 + index).padStart(2, "0")}`,
      })) },
    ]) {
      const unavailable = mountComposer({ ...props, dragActive: true });
      expect(unavailable.get('[aria-label="添加图片或文件"]').attributes("disabled")).toBeDefined();
      expect(unavailable.find(".chat-composer__drop-overlay").exists()).toBe(false);
    }
  });

  it("blocks a turn when combined image bytes exceed the runtime transport budget", () => {
    const images: ChatAttachment[] = [0, 1].map((index) => ({
      ...READY_FILE,
      attachmentId: `019c1a00-0000-7000-8000-00000000000${index + 3}`,
      type: "image",
      name: `synthetic-${index}.png`,
      mediaType: "image/png",
      sizeBytes: 6 * 1024 * 1024,
    }));
    const wrapper = mountComposer({ modelValue: "", attachments: images });
    expect(wrapper.text()).toContain("图片总大小不能超过 10 MB");
    expect(wrapper.get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
  });

  it("keeps blocking readiness and recovery visible while hiding the ready state", async () => {
    const wrapper = mountComposer({
      readiness: {
        title: "本地服务暂不可用",
        detail: "请重试启动本地服务。",
        actionLabel: "重试启动",
        tone: "warning",
      },
      canSend: false,
      recoveryAvailable: true,
    });
    expect(wrapper.get(".chat-composer__readiness").text()).toContain("本地服务暂不可用");
    await wrapper.get(".chat-composer__recovery").trigger("click");
    expect(wrapper.emitted("recover")).toHaveLength(1);
  });

  it("shows specific native attachment rejection guidance", () => {
    expect(mountComposer({ attachmentErrorCode: "too_large" }).text()).toContain("文件不能超过 10 MB");
    expect(mountComposer({ attachmentErrorCode: "archive_unsupported" }).text())
      .toContain("暂不支持压缩包，请先解压后选择文件");
    expect(mountComposer({ attachmentErrorCode: "parse_failed" }).text())
      .toContain("无法读取此文件，可移除后重新选择");
  });

  it("removes the byte counter but keeps the over-limit validation error accessible", () => {
    const wrapper = mountComposer({ modelValue: "A".repeat(65_537) });
    expect(wrapper.get("#chat-composer-validation").text()).toContain("输入内容过长");
    expect(wrapper.get("textarea").attributes("aria-describedby")).toBe("chat-composer-validation");
    expect(wrapper.get("textarea").attributes("aria-invalid")).toBe("true");
    expect(wrapper.text()).not.toContain("65536 字节");
  });

  it("uses a content-only markup snapshot for light/dark visual regression", () => {
    document.documentElement.dataset.theme = "dark";
    const wrapper = mountComposer();
    expect({
      root: wrapper.get(".chat-composer").classes(),
      project: wrapper.get(".chat-composer__project").text(),
      projectLabel: wrapper.get(".chat-composer__project").attributes("aria-label"),
      permission: wrapper.get(".chat-composer__permission").text(),
      permissionParent: wrapper.get(".chat-composer__permission").element.parentElement?.className,
      readinessVisible: wrapper.find(".chat-composer__readiness").exists(),
      textareaDescribedBy: wrapper.get("textarea").attributes("aria-describedby") ?? null,
      action: wrapper.get('[aria-label="发送任务"]').attributes("title"),
      theme: document.documentElement.dataset.theme,
    }).toMatchInlineSnapshot(`
      {
        "action": "发送任务",
        "permission": "权限审批只读 · 禁止写入",
        "permissionParent": "chat-composer__leading-actions",
        "project": "Synthetic Project",
        "projectLabel": "更换项目，当前项目 Synthetic Project",
        "readinessVisible": false,
        "root": [
          "chat-composer",
          "chat-composer--new",
        ],
        "textareaDescribedBy": null,
        "theme": "dark",
      }
    `);
  });
});
