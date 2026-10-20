import { describe, expect, it } from "vitest";
import { installedSkill } from "../test/skill-fixture";
import { compileSkillInput, presentSkillMessage, selectedSkillIssue, skillSelectionIssue } from "./chat-skills";

describe("per-turn explicit skill selection", () => {
  it("compiles multiple canonical mentions once and leaves the user's text unchanged", () => {
    const second = { ...installedSkill, id: "yijie.store-operations.invoice-generator", runtimeName: "invoice-generator" };
    expect(compileSkillInput("整理这份合成资料。", [installedSkill, second, installedSkill]))
      .toBe("$copywriting $invoice-generator\n\n整理这份合成资料。");
    expect(compileSkillInput("普通原文", [])).toBe("普通原文");
  });
  it("requires the selected installed identity to remain enabled and Runtime-visible", () => {
    expect(selectedSkillIssue(installedSkill, [installedSkill])).toBeNull();
    expect(selectedSkillIssue(installedSkill, [])).toContain("已卸载");
    expect(selectedSkillIssue(installedSkill, [{ ...installedSkill, runtimeName: "updated-name" }])).toContain("已更新");
    expect(skillSelectionIssue({ ...installedSkill, enabled: false, runtimeVisible: false })).toContain("已停用");
    expect(skillSelectionIssue({ ...installedSkill, runtimeVisible: false })).toContain("尚未就绪");
    expect(skillSelectionIssue({ ...installedSkill, failureCode: "runtime_sync_failed" })).toContain("暂不可用");
  });
});


describe("sent skill message presentation", () => {
  const textBlock = (text: string) => Object.freeze({ identity: "text", blockIndex: 0, type: "text" as const, text });
  it("projects multiple mentions inline without changing original input or subsequent paragraphs", () => {
    const second = { ...installedSkill, id: "invoice", runtimeName: "invoice-generator", displayName: "发票生成" };
    const body = "生成一张发票\n\n备注：保留 $copywriting 原文。";
    const raw = compileSkillInput(body, [installedSkill, second]);
    const blocks = Object.freeze([textBlock(raw), textBlock("补充资料")]);
    const result = presentSkillMessage(blocks, [installedSkill, second]);
    expect(result.skills.map(skill => skill.displayName)).toEqual(["跨境营销文案", "发票生成"]);
    expect(result.blocks[0]).toMatchObject({ text: body });
    expect(result.blocks[1]).toBe(blocks[1]);
    expect(blocks[0]!.text).toBe(raw);
  });
  it("keeps ordinary text and incomplete, unknown or ambiguous prefixes literal", () => {
    for (const text of ["价格 $20", "请使用 $copywriting", "$copywriting\n普通正文", "$unknown-skill\n\n正文", "$copywriting $unknown-skill\n\n正文"]) {
      const blocks = [textBlock(text)];
      expect(presentSkillMessage(blocks, [installedSkill])).toEqual({ blocks, skills: [] });
    }
    const blocks = [textBlock("$copywriting\n\n正文")];
    expect(presentSkillMessage(blocks, [installedSkill, { ...installedSkill, id: "duplicate" }]).blocks).toBe(blocks);
    expect(presentSkillMessage(blocks, []).blocks).toBe(blocks);
  });
  it("preserves skill-only attachment prompts", () => {
    const result = presentSkillMessage([textBlock(compileSkillInput("", [installedSkill]))], [installedSkill]);
    expect(result.skills).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({ text: "" });
  });
});
