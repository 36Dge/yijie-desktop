// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { installedSkill } from "../../test/skill-fixture";
import ChatSkillChips from "./ChatSkillChips.vue";

it("renders a removable selection with an accessible name and keeps busy controls inert", async () => {
  const view = mount(ChatSkillChips, { props: { entries: [{ ...installedSkill, unavailableReason: null }] } });
  const remove = view.get('button[aria-label="移除技能 跨境营销文案"]');
  await remove.trigger("click");
  expect(view.emitted("remove")).toEqual([[installedSkill.id]]);
  await view.setProps({ disabled: true });
  await remove.trigger("click");
  expect(view.emitted("remove")).toHaveLength(1);
  await view.setProps({ disabled: false, entries: [{ ...installedSkill, unavailableReason: "技能已停用" }] });
  expect(remove.attributes("title")).toContain("技能已停用");
  expect(view.text()).toContain("跨境营销文案");
  view.unmount();
});
