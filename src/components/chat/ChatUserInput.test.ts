// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ChatUserInput from "./ChatUserInput.vue";
import type { UserInputRequest } from "../../api/user-input-client";
const question = (id: string) => ({ id, header: "普通问题", question: `请填写${id}`, isOther: true, isSecret: false });
function request(): UserInputRequest { return { request_id: "10000000-0000-4000-8000-000000000001", turn_id: "ordinary-turn", item_id: "ordinary-item", state: "pending", timeout_paused: false, questions: [{ ...question("choice"), options: [{ label: "蓝色（推荐）", description: "普通选项" }, { label: "绿色", description: "另一选项" }] }, question("text")] }; }
const props = () => ({ request: request(), disabled: false, submitting: false });
describe("native user input card", () => {
  it("does not preselect recommendations and sends one original question map after navigation", async () => {
    const w = mount(ChatUserInput, { props: props() });
    expect(w.findAll('[aria-pressed="true"]')).toHaveLength(0);
    expect(w.get(".primary").attributes("disabled")).toBeDefined();
    await w.findAll(".user-input__option")[1].trigger("click");
    await w.get(".primary").trigger("click");
    await w.get("textarea").setValue("普通自由输入");
    await w.get('[aria-label="上一题"]').trigger("click");
    expect(w.findAll('[aria-pressed="true"]')).toHaveLength(1);
    await w.get('[aria-label="下一题"]').trigger("click");
    expect((w.get("textarea").element as HTMLTextAreaElement).value).toBe("普通自由输入");
    await w.get(".primary").trigger("click");
    expect(w.emitted("answer")).toEqual([[{ choice: { answers: ["绿色"] }, text: { answers: ["普通自由输入"] } }]]);
    w.unmount();
  });
  it("masks freeform values, reveals only explicitly, and clears on submit or request change", async () => {
    const p = props(); p.request.questions = [{ ...question("sensitive"), isSecret: true }];
    const w = mount(ChatUserInput, { props: p });
    expect(w.get("input").attributes("type")).toBe("password");
    await w.get("input").setValue("synthetic-blue");
    expect(w.text()).not.toContain("synthetic-blue");
    await w.get(".user-input__secret button").trigger("click");
    expect(w.get("input").attributes("type")).toBe("text");
    await w.setProps({ request: { ...p.request, request_id: "10000000-0000-4000-8000-000000000002" } });
    expect((w.get("input").element as HTMLInputElement).value).toBe("");
    expect(w.get("input").attributes("type")).toBe("password");
    await w.get("input").setValue("ordinary-note");
    await w.setProps({ submitting: true });
    expect((w.get("input").element as HTMLInputElement).value).toBe("");
    w.unmount();
  });
  it("skips the current question and closes the group with empty native answers", async () => {
    const w = mount(ChatUserInput, { props: props() });
    await w.get(".secondary").trigger("click");
    await w.get("textarea").setValue("unsent ordinary text");
    await w.get('[aria-label="关闭并跳过本组问题"]').trigger("click");
    expect(w.emitted("answer")).toEqual([[{}]]);
    w.unmount();
  });
  it("keeps IME composition and unavailable state from submitting", async () => {
    const p = props(); p.request.questions = [question("text")];
    const w = mount(ChatUserInput, { props: p });
    await w.get("textarea").setValue("正常输入");
    await w.get("textarea").trigger("keydown", { key: "Enter", ctrlKey: true, isComposing: true });
    expect(w.emitted("answer")).toBeUndefined();
    await w.setProps({ disabled: true });
    await w.get(".primary").trigger("click");
    expect(w.emitted("answer")).toBeUndefined();
    w.unmount();
  });
});
