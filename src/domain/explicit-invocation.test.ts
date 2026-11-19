import { describe, expect, it } from "vitest";
import { installedSkill } from "../test/skill-fixture";
import { explicitSkillInvocation } from "./explicit-invocation";

const negotiate = { ...installedSkill, id: "sales", displayName: "销售谈判专家", runtimeName: "sales-negotiator" };
const catalog = [negotiate, installedSkill];

describe("explicit skill invocation", () => {
  it.each(["调用销售谈判专家，给我生成一个谈判策略", "请使用“销售谈判专家”技能来分析", "销售谈判专家，帮我准备谈判", "请调用技能「销售谈判专家」", "这次请调用销售谈判专家制定方案", "这份方案请使用【销售谈判专家】协助完成", "please use sales-negotiator for this plan"])("resolves the named skill in %s", text => {
    expect(explicitSkillInvocation(text, catalog, [])).toMatchObject({ mentions: [negotiate], addressesFirst: true, issue: "" });
  });
  it("keeps the native dollar syntax as original text while checking known unavailable names", () => {
    expect(explicitSkillInvocation("$sales-negotiator，帮我准备谈判", catalog, []))
      .toMatchObject({ mentions: [], nativeMentions: [negotiate], issue: "" });
    expect(explicitSkillInvocation("本轮请用 $sales-negotiator 准备谈判", catalog, []))
      .toMatchObject({ mentions: [], nativeMentions: [negotiate] });
    expect(explicitSkillInvocation("说明示例 `$sales-negotiator`", catalog, []).nativeMentions).toEqual([]);
  });
  it("keeps exact names in multiple directives and leaves the expert at the start independent", () => {
    expect(explicitSkillInvocation("用销售谈判专家和跨境营销文案写方案", catalog, []).mentions).toEqual(catalog);
    expect(explicitSkillInvocation("用分镜专家画分镜，然后调用销售谈判专家准备讨论", catalog, []))
      .toMatchObject({ mentions: [negotiate], addressesFirst: false });
  });
  it.each(["帮我准备谈判", "不要调用销售谈判专家", "请解释“调用销售谈判专家”的意思", "销售谈判专家有什么功能？", "销售谈判专家，怎么启用？", "使用销售谈判专家指南写摘要", "请使用技能帮我写文案", "如有需要，请调用销售谈判专家", "原文是“请使用销售谈判专家”"])("leaves the native choice alone in %s", text => {
    expect(explicitSkillInvocation(text, catalog, [])).toMatchObject({ mentions: [], issue: "" });
  });
  it("uses the picked identity for duplicate names and acknowledges an explicitly missing skill", () => {
    const other = { ...negotiate, id: "imported" };
    expect(explicitSkillInvocation("调用销售谈判专家", [negotiate, other], []).issue).toContain("多个");
    expect(explicitSkillInvocation("调用销售谈判专家", [negotiate, other], [other]).mentions).toEqual([other]);
    expect(explicitSkillInvocation("调用技能「我的报价助手」", catalog, []).issue).toContain("没有找到技能“我的报价助手”");
    expect(explicitSkillInvocation("调用库存复盘技能，分析库存", catalog, []).issue).toContain("库存复盘");
  });
});
