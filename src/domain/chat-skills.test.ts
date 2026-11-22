import { afterEach, describe, expect, it, vi } from "vitest";
import { installedSkill } from "../test/skill-fixture";
import { compileSkillInput, compileSelectedSkillRefs, prepareSkillText, presentSkillMessage, selectedSkillIssue, skillInvocationToolNotice, skillSelectionIssue } from "./chat-skills";

afterEach(() => vi.unstubAllEnvs());

describe("per-turn explicit skill selection", () => {
  it.each([false, true])("round trips a skill-only turn including an older selection without an offset (legacy=%s)", legacy => {
    const selected = [installedSkill, { ...installedSkill, id: "invoice", runtimeName: "invoice", offset: 0 }];
    const sent = prepareSkillText("  ", selected, legacy);
    expect(sent.text).toBe("【技能1 $copywriting】【技能2 $invoice】");
    const rendered = presentSkillMessage([{ type: "text", identity: "message:0", blockIndex: 0, text: sent.text, skills: compileSelectedSkillRefs(selected) }], selected, { offsets: sent.markerStarts });
    expect(rendered.skills.map(skill => skill.id)).toEqual(selected.map(skill => skill.id));
    expect(rendered.blocks[0]).toHaveProperty("text", "");
  });

  it("reports confirmed skill tool conditions without assigning an aggregate status to every tool", () => {
    const entry = { ...installedSkill, requiredTools: ["orders"] };
    expect(skillInvocationToolNotice({ ...entry, dependencyState: "ready" })).toBeNull();
    expect(skillInvocationToolNotice({ ...entry, dependencyState: "unknown" })).toBeNull();
    expect(skillInvocationToolNotice({ ...entry, dependencyState: "needs_authorization" })).toContain("「orders」尚未授权");
    const issue = skillInvocationToolNotice({ ...entry, requiredTools: ["orders", "inventory"], dependencyState: "missing" });
    expect(issue).toContain("有必备工具尚未接入");
    expect(issue).not.toContain("「orders」尚未接入");
  });

  it("requires re-selection after a managed version changes in the native input profile", () => {
    vi.stubEnv("VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED", "true");
    expect(selectedSkillIssue(installedSkill, [{ ...installedSkill, version: "2.0.0" }])).toContain("已更新");
  });
  it("freezes the selected managed identity without exposing a path or prompt", () => {
    const selected = { ...installedSkill };
    const frozen = compileSelectedSkillRefs([selected]);
    expect(frozen).toEqual([{ id: selected.id, version: selected.version }]);
    const version = selected.version;
    selected.version = "2.0.0";
    expect(frozen[0]?.version).toBe(version);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen[0])).toBe(true);
  });
  it("compiles multiple canonical mentions once and leaves the user's text unchanged", () => {
    const second = { ...installedSkill, id: "yijie.store-operations.invoice-generator", runtimeName: "invoice-generator" };
    expect(compileSkillInput("整理这份合成资料。", [installedSkill, second, installedSkill]))
      .toBe("$copywriting $invoice-generator\n\n整理这份合成资料。");
    expect(compileSkillInput("普通原文", [])).toBe("普通原文");
  });
  it.each([false, true])("serializes each picked skill at its own UTF-16 insertion point (legacy=%s)", legacy => {
    const text = "  📦先对比商品，\n再写标题。  ";
    const compare = { ...installedSkill, id: "compare", runtimeName: "market:compare" };
    const selection = [
      { ...compare, offset: text.indexOf("对比") },
      { ...installedSkill, offset: text.indexOf("写标题") },
    ];
    const sent = prepareSkillText(text, selection, legacy);
    expect(sent.text).toBe("📦先【技能1 $market:compare】对比商品，\n再【技能2 $copywriting】写标题。");
    expect(sent.markerStarts).toEqual([sent.text.indexOf("【技能1"), sent.text.indexOf("【技能2")]);
    expect(prepareSkillText(text, [{ ...selection[0]!, offset: 0 }, { ...selection[1]!, offset: text.length }], legacy).text)
      .toBe("【技能1 $market:compare】" + text + "【技能2 $copywriting】");
    expect(prepareSkillText(text, selection, legacy)).toEqual(sent);
  });
  it("retains adjacent chip order and keeps inferred native selections in the original prose", () => {
    const second = { ...installedSkill, id: "other", runtimeName: "editor" };
    expect(prepareSkillText("甲乙", [{ ...second, offset: 1 }, { ...installedSkill, offset: 1 }], false).text)
      .toBe("甲【技能1 $editor】【技能2 $copywriting】乙");
    const text = "调用跨境营销文案写标题。";
    expect(prepareSkillText(text, [installedSkill], false).text).toBe(text);
    expect(prepareSkillText(text, [installedSkill], true).text).toBe("$copywriting\n\n" + text);
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
  it.each([false, true])("shows the picked skill and keeps a different skill named in the same text as prose (legacy=%s)", legacy => {
    const text = "请使用跨境营销文案写标题，再核对金额。";
    const picked = { ...installedSkill, id: "invoice", runtimeName: "invoice", displayName: "发票生成", offset: text.indexOf("核对") };
    const selection = [picked, installedSkill];
    const sent = prepareSkillText(text, selection, legacy);
    const block = { ...textBlock(sent.text), ...(!legacy && { skills: compileSelectedSkillRefs(selection) }) };
    const result = presentSkillMessage([block], selection, { offsets: sent.markerStarts, pickedCount: 1 });
    expect(result.skills.map(skill => skill.id)).toEqual([picked.id]);
    expect(result.offsets).toEqual([picked.offset]);
    expect(result.blocks[0]).toHaveProperty("text", text);

    const namedOnly = prepareSkillText(text, [installedSkill], legacy);
    const namedBlock = { ...textBlock(namedOnly.text), ...(!legacy && { skills: compileSelectedSkillRefs([installedSkill]) }) };
    const reopened = presentSkillMessage([namedBlock], [], { offsets: namedOnly.markerStarts, pickedCount: 0, prefixLength: namedOnly.prefixLength });
    expect(reopened.skills).toEqual([]);
    expect(reopened.blocks[0]).toHaveProperty("text", text);
  });

  it("keeps a manually typed dollar-mention line literal when the turn has no picks", () => {
    const blocks = [textBlock("$copywriting\n\n整理商品清单。")];
    expect(presentSkillMessage(blocks, [installedSkill], { offsets: [], pickedCount: 0 })).toEqual({ blocks, skills: [] });
  });

  it("restores two markers from the saved message and keeps a typed copy of a marker literal", () => {
    const first = { ...installedSkill, offset: 1 };
    const second = { ...installedSkill, id: "analysis", runtimeName: "market:compare", offset: 3 };
    const selection = [first, second];
    const text = "先写，再查。";
    const sent = prepareSkillText(text, selection, false);
    const block = { ...textBlock(sent.text), skills: compileSelectedSkillRefs(selection) };
    expect(presentSkillMessage([block], [])).toMatchObject({
      blocks: [{ text }], skills: [{ displayName: first.id }, { displayName: second.id }], offsets: [1, 3],
    });
    const literal = "示例【技能1 $copywriting】，先写，再查。";
    const picked = [{ ...first, offset: literal.indexOf("写") }, { ...second, offset: literal.indexOf("查") }];
    const example = prepareSkillText(literal, picked, false);
    const result = presentSkillMessage([{ ...block, text: example.text }], selection, { offsets: example.markerStarts });
    expect(result.blocks[0]).toMatchObject({ text: literal });
    expect(result.offsets).toEqual(picked.map(skill => skill.offset));
    expect(presentSkillMessage([textBlock(sent.text)], selection).skills).toEqual([]);
    expect(presentSkillMessage([textBlock(sent.text)], selection, { offsets: sent.markerStarts }).offsets).toEqual([1, 3]);
  });
  it("uses ordered selected identities, retaining the saved ID if that version is no longer in the catalog", () => {
    const selected = { id: installedSkill.id, version: installedSkill.version };
    const removed = { id: "older-listing-skill", version: "1.0.0" };
    const blocks = [{ ...textBlock("比较这两个商品"), skills: [removed, selected] }];
    const catalog = [installedSkill, { ...installedSkill, ...removed, version: "2.0.0", displayName: "另一个版本" }];
    const result = presentSkillMessage(blocks, catalog);
    expect(result.skills.map(skill => skill.displayName)).toEqual([removed.id, installedSkill.displayName]);
    expect(result.blocks).toBe(blocks);
    const both = [{ ...textBlock(compileSkillInput("原文", [installedSkill])), skills: [selected] }];
    expect(presentSkillMessage(both, catalog)).toMatchObject({ blocks: [{text: "原文"}], skills: [{id: selected.id}] });
  });
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
