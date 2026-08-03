// @vitest-environment happy-dom

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatProject } from "../../domain/chat-ipc";
import ChatComposer from "./ChatComposer.vue";

const PROJECT: ChatProject = {
  projectId: "019c1a00-0000-7000-8000-000000000001",
  safeName: "Synthetic Project",
  pinnedAt: null,
  lastUsedAt: 1,
  available: true,
};

function mountComposer(overrides: Record<string, unknown> = {}) {
  return mount(ChatComposer, {
    props: {
      modelValue: "检查商品标题",
      mode: "new",
      projects: [PROJECT],
      selectedProjectId: PROJECT.projectId,
      readiness: { title: "本地运行环境已就绪", detail: "只读", actionLabel: null, tone: "success" },
      canSend: true,
      sending: false,
      streaming: false,
      recoveryAvailable: false,
      ...overrides,
    },
    global: {
      stubs: {
        NSelect: { template: "<select id='chat-project-select' aria-label='聊天项目'><option>Synthetic Project</option></select>" },
      },
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("ChatComposer", () => {
  it("renders only the approved text/project/permission/send controls", () => {
    const wrapper = mountComposer();
    expect(wrapper.get("textarea").attributes("aria-describedby")).toContain("chat-composer-validation");
    expect(wrapper.find('[aria-label="发送任务"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("权限审批");
    expect(wrapper.text()).toContain("只读 · 禁止写入");
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/模型选择|推理强度|语音|附件/);
  });

  it("submits once with Command+Enter and never submits while composing", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.trigger("compositionstart");
    await textarea.trigger("keydown", { key: "Enter", metaKey: true });
    expect(wrapper.emitted("submit")).toBeUndefined();
    await textarea.trigger("compositionend");
    await textarea.trigger("keydown", { key: "Enter", metaKey: true });
    expect(wrapper.emitted("submit")).toHaveLength(1);
    await textarea.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("submit")).toHaveLength(1);
  });

  it("disables send for blank input, missing project, unavailable readiness and active turn", async () => {
    expect(mountComposer({ modelValue: "" }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ selectedProjectId: null }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ canSend: false }).get('[aria-label="发送任务"]').attributes("disabled")).toBeDefined();
    expect(mountComposer({ streaming: true }).find('[aria-label="停止生成"]').exists()).toBe(true);
  });

  it("rejects file paste and drop without exposing the clipboard payload", async () => {
    const wrapper = mountComposer();
    const textarea = wrapper.get("textarea");
    await textarea.trigger("paste", {
      clipboardData: { files: [{ name: "private.png" }], items: [{ kind: "file" }] },
    });
    await wrapper.get(".chat-composer__field").trigger("drop", {
      dataTransfer: { files: [{ name: "private.txt" }] },
    });
    const events = wrapper.emitted("unsupported-input") ?? [];
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain("private.png");
  });

  it("uses a content-only markup snapshot for light/dark visual regression", () => {
    document.documentElement.dataset.theme = "dark";
    const wrapper = mountComposer();
    expect({
      root: wrapper.get(".chat-composer").classes(),
      context: wrapper.get(".chat-composer__context").text(),
      readiness: wrapper.get(".chat-composer__readiness").text(),
      textareaLabel: wrapper.get("textarea").attributes("aria-describedby"),
      action: wrapper.get('[aria-label="发送任务"]').attributes("title"),
      theme: document.documentElement.dataset.theme,
    }).toMatchInlineSnapshot(`
      {
        "action": "发送任务",
        "context": "聊天项目Synthetic Project 选择其他项目 权限审批只读 · 禁止写入",
        "readiness": "本地运行环境已就绪只读",
        "root": [
          "chat-composer",
          "chat-composer--new",
        ],
        "textareaLabel": "chat-composer-hint chat-composer-validation",
        "theme": "dark",
      }
    `);
  });
});
