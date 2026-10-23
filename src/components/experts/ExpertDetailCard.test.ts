// @vitest-environment happy-dom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ExpertDetailCard from "./ExpertDetailCard.vue";

const original = "请根据我的商品资料，完成目标市场的商品评估、上架文案和一周推广计划，缺数据明确标注。";
const props = {
  name: "跨境电商运营专家", developer: "易界 AI", version: "0.1.1",
  expertId: "cross-border-ecommerce-operations-expert", description: "示例介绍",
  tags: [], quickPrompts: [original], interactive: true,
};

describe("expert prompt presentation", () => {
  it("shows concise copy while retaining the complete accessible question and draft", async () => {
    const view = mount(ExpertDetailCard, { props });
    try {
      const prompt = view.get(".expert-detail__prompt");
      expect(prompt.get("span").text()).toBe("“评估商品，规划上架文案和一周推广”");
      expect(prompt.attributes("aria-label")).toBe(`去试试：${original}`);
      await prompt.trigger("click");
      expect(view.emitted("prompt")).toEqual([[original]]);
    } finally { view.unmount(); }
  });

  it("does not reuse stale display copy when a catalog version changes its question", async () => {
    const view = mount(ExpertDetailCard, { props });
    const updated = "请核对新资料。\n请保留来源。";
    try {
      await view.setProps({ version: "0.2.0", quickPrompts: [updated] });
      const prompt = view.get(".expert-detail__prompt");
      expect(prompt.get("span").text()).toBe("“请核对新资料。 请保留来源。”");
      await prompt.trigger("click");
      expect(view.emitted("prompt")).toEqual([[updated]]);
    } finally { view.unmount(); }
  });
});
