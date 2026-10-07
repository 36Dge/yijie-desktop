// @vitest-environment happy-dom
import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import ChatWorkspaceControl from "./ChatWorkspaceControl.vue";

const entry = { project: { projectId: "019c1a00-0000-7000-8000-000000000001", safeName: "市场调研", pinnedAt: null, lastUsedAt: 1, available: true }, path: "/Users/example/Yijie/Workspaces/市场调研" };
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ""; });
function setup() {
  const wrapper = mount(ChatWorkspaceControl, { attachTo: document.body, props: {
    entries: [entry], selectedProjectId: null, disabled: false, loading: false, error: "",
    rootPath: "/Users/example/Yijie/Workspaces", createOpen: false, creating: false, createError: "",
  } });
  wrappers.push(wrapper); return wrapper;
}
function menuAction(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(button => button.textContent?.includes(text))!;
}
describe("workspace control", () => {
  it("opens a menu before invoking the native picker and shows the saved path", async () => {
    const wrapper = setup(); await wrapper.get(".workspace-trigger").trigger("click"); await flushPromises();
    expect(wrapper.emitted("open-local")).toBeUndefined();
    expect(wrapper.emitted("refresh")).toHaveLength(1);
    const option = document.querySelector<HTMLButtonElement>('[role="menuitemradio"]')!;
    expect(option.title).toBe(entry.path);
    option.click(); await flushPromises();
    expect(wrapper.emitted("select")).toEqual([[entry.project.projectId]]);
    await wrapper.setProps({ selectedProjectId: entry.project.projectId });
    expect(wrapper.get(".workspace-trigger").attributes("title")).toBe(entry.path);
    await wrapper.get(".workspace-trigger").trigger("click"); await flushPromises();
    menuAction("不使用工作空间").click(); await flushPromises();
    expect(wrapper.emitted("select")?.slice(-1)[0]).toEqual([null]);
    await wrapper.get(".workspace-trigger").trigger("click"); await flushPromises();
    menuAction("打开本地文件夹").click(); await flushPromises();
    expect(wrapper.emitted("open-local")).toHaveLength(1);
  });
  it("searches saved spaces and supports keyboard selection and Escape", async () => {
    const wrapper = setup(); await wrapper.get(".workspace-trigger").trigger("keydown", { key: "ArrowDown" }); await flushPromises();
    expect(document.activeElement?.getAttribute("role")).toBe("menuitemradio");
    const input = new DOMWrapper(document.querySelector<HTMLInputElement>('.workspace-search input')!);
    await input.setValue("没有匹配"); await flushPromises();
    expect(document.querySelectorAll('[role="menuitemradio"]')).toHaveLength(0);
    expect(document.querySelector('.workspace-list')?.textContent).toContain("没有匹配");
    await input.trigger("keydown", { key: "Escape" }); await flushPromises();
    expect(wrapper.get(".workspace-trigger").attributes("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(wrapper.get(".workspace-trigger").element);
  });
  it("submits the named create dialog and keeps errors visible without closing", async () => {
    const wrapper = setup(); await wrapper.get(".workspace-trigger").trigger("click"); await flushPromises();
    menuAction("新建工作空间").click(); await flushPromises();
    expect(wrapper.emitted("update:createOpen")).toEqual([[true]]);
    await wrapper.setProps({ createOpen: true }); await flushPromises();
    const input = new DOMWrapper(document.querySelector<HTMLInputElement>('#workspace-name-input')!);
    await input.setValue("市场调研");
    await new DOMWrapper(document.querySelector<HTMLFormElement>('.workspace-create form')!).trigger("submit");
    expect(wrapper.emitted("create")).toEqual([["市场调研"]]);
    await wrapper.setProps({ createError: "同名文件夹已存在" });
    expect(document.querySelector('.workspace-create [role="alert"]')?.textContent).toContain("同名");
    expect((input.element as HTMLInputElement).value).toBe("市场调研");
    await wrapper.setProps({ creating: true, createError: "" });
    expect((input.element as HTMLInputElement).disabled).toBe(true);
  });
});
