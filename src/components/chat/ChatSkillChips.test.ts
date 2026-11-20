// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import { installedSkill } from "../../test/skill-fixture";
import { skillCardArtwork } from "../../icons/skill-artwork";
import ChatSkillChips from "./ChatSkillChips.vue";

it("uses the same artwork as the skill picker for each selection, independent of its display name", () => {
  const entries = [
    { ...installedSkill, id: "yijie.traffic-advertising.amazon-listing-expert", category: "traffic-advertising" as const, displayName: "选中技能", unavailableReason: null },
    { ...installedSkill, displayName: "选中技能", unavailableReason: null },
    { ...installedSkill, id: "imported-skill", category: "personal" as const, unavailableReason: null },
  ];
  const view = mount(ChatSkillChips, { props: { entries } });
  expect(view.findAll("button img.chat-skill-mention-icon").map(icon => icon.attributes("src"))).toEqual(entries.map(skillCardArtwork));
  expect(new Set(entries.map(skillCardArtwork)).size).toBe(entries.length);
  view.unmount();
});

it("renders a removable selection with an accessible name and keeps busy controls inert", async () => {
  const view = mount(ChatSkillChips, { props: { entries: [{ ...installedSkill, unavailableReason: null }] } });
  const remove = view.get('button[aria-label="移除技能 跨境营销文案"]');
  await remove.trigger("click");
  expect(view.emitted("remove")).toEqual([[installedSkill.id]]);
  await view.setProps({ disabled: true });
  await remove.trigger("click");
  expect(view.emitted("remove")).toHaveLength(1);
  await view.setProps({ disabled: false, entries: [{ ...installedSkill, unavailableReason: "技能已停用" }] });
  expect(remove.attributes("data-yj-tooltip")).toBeUndefined();
  expect(remove.text()).toContain("技能已停用");
  expect(view.text()).toContain("跨境营销文案");
  view.unmount();
});
