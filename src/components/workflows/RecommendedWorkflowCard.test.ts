// @vitest-environment happy-dom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import axe from "axe-core";
import RecommendedWorkflowCard from "./RecommendedWorkflowCard.vue";
import { RECOMMENDED_WORKFLOWS } from "../../domain/workflow-showcase";

let wrapper: VueWrapper;
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ""; });

describe("recommended workflow actions", () => {
  it("opens a labelled preview with preparation, outputs and steps, then closes without using it", async () => {
    const workflow = RECOMMENDED_WORKFLOWS[0]!;
    wrapper = mount(RecommendedWorkflowCard, { attachTo: document.body, props: { workflow } });
    const preview = wrapper.get('button[aria-haspopup="dialog"]');
    await preview.trigger("click");
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(workflow.input);
    expect(dialog.textContent).toContain(workflow.output);
    expect(Array.from(dialog.querySelectorAll("li")).map(node => node.textContent)).toEqual(workflow.nodes.map(node => node.label));
    expect(dialog.textContent).toContain("业务节点尚未接入");
    const audit = await axe.run(dialog, { rules: { region: { enabled: false } } });
    expect(audit.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    document.querySelector<HTMLButtonElement>('[aria-label="关闭工作流预览"]')!.click();
    await flushPromises();
    expect(preview.attributes("aria-expanded")).toBe("false");
    expect(wrapper.emitted("use")).toBeUndefined();
  });

  it("shows the same example notice as entering a workflow, without opening a dialog", async () => {
    wrapper = mount(RecommendedWorkflowCard, { attachTo: document.body, props: { workflow: RECOMMENDED_WORKFLOWS[1]! } });
    const use = wrapper.get(".workflow-card-action--primary");
    await use.trigger("click");
    await flushPromises();
    expect(use.attributes("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="status"]')?.textContent).toContain("此工作流为示例方案，暂未开放");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.emitted("use")).toBeUndefined();
    await use.trigger("keyup", { key: "Escape" });
    await flushPromises();
    expect(use.attributes("aria-expanded")).toBe("false");
    expect(wrapper.findAll("[aria-pressed]")).toHaveLength(0);
  });
});
