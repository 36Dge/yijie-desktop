// @vitest-environment happy-dom
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatWorkspaceClient } from "../api/chat-workspace-client";
import type { WorkspaceCreation } from "../domain/chat-workspace";
import { useChatWorkspaces } from "./useChatWorkspaces";

const entry = { project: { projectId: "019c1a00-0000-7000-8000-000000000001", safeName: "市场调研", pinnedAt: null, lastUsedAt: 1, available: true }, path: "/Users/example/Yijie/Workspaces/市场调研" };
afterEach(() => vi.restoreAllMocks());
function setup(create: (name: string) => Promise<WorkspaceCreation | null>) {
  const context = ref("context-one"), enabled = ref(true), selected = ref<string | null>(null);
  let picker!: ReturnType<typeof useChatWorkspaces>;
  const wrapper = mount(defineComponent({ setup() { picker = useChatWorkspaces({ context: () => context.value, enabled: () => enabled.value, projects: () => [entry.project], selected: () => selected.value, select: id => { selected.value = id; }, create }); return () => h("div"); } }));
  return { picker, wrapper, context, enabled, selected };
}
describe("workspace picker", () => {
  it("selects a successfully registered space, preserves its path and closes creation", async () => {
    const create = vi.fn(async (): Promise<WorkspaceCreation> => ({ status: "created", workspace: entry }));
    const { picker, wrapper, selected } = setup(create);
    picker.setCreateOpen(true);
    await picker.create("  市场调研  ");
    expect(create).toHaveBeenCalledWith("市场调研");
    expect(selected.value).toBe(entry.project.projectId);
    expect(picker.entries.value[0]?.path).toBe(entry.path);
    expect(picker.createOpen.value).toBe(false);
    wrapper.unmount();
  });
  it("keeps the create dialog open on name conflicts without changing selection", async () => {
    const { picker, wrapper, selected } = setup(async () => ({ status: "name_conflict", workspace: null }));
    picker.setCreateOpen(true); await picker.create("市场调研");
    expect(picker.createOpen.value).toBe(true);
    expect(picker.createError.value).toContain("同名文件夹已存在");
    expect(selected.value).toBeNull(); wrapper.unmount();
  });
  it("discards delayed creation after changing account or navigating to a conversation", async () => {
    let resolve!: (value: WorkspaceCreation) => void;
    const { picker, wrapper, context, selected } = setup(() => new Promise(done => { resolve = done; }));
    picker.setCreateOpen(true); const pending = picker.create("市场调研");
    context.value = "context-two"; await flushPromises();
    resolve({ status: "created", workspace: entry }); await pending;
    expect(selected.value).toBeNull(); expect(picker.createOpen.value).toBe(false);
    expect(picker.entries.value[0]?.path).toBeNull(); wrapper.unmount();
  });
  it("does not let an older catalog response replace a newly created path", async () => {
    let resolve!: (value: { rootPath: string; workspaces: [] }) => void;
    vi.spyOn(chatWorkspaceClient, "catalog").mockImplementation(() => new Promise(done => { resolve = done; }));
    const { picker, wrapper } = setup(async () => ({ status: "created", workspace: entry }));
    const pending = picker.refresh(); await picker.create("市场调研");
    resolve({ rootPath: "/Users/example/Yijie/Workspaces", workspaces: [] }); await pending;
    expect(picker.entries.value[0]?.path).toBe(entry.path); wrapper.unmount();
  });
});
