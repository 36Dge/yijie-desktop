import { expect, it } from "vitest";
import { installedSkill } from "../test/skill-fixture";
import { insertDraftSkill, positionsAfterTextEdit } from "./chat-skill-placement";

it("inserts between adjacent skills and replaces just the selected text and skills", () => {
  const text = "📦商品\n说明";
  const skills = ["a", "b", "c"].map((id, i) => ({ ...installedSkill, id, offset: i < 2 ? 2 : 5 }));
  const between = insertDraftSkill(text, skills, installedSkill, { selectionStart: 3, selectionEnd: 3 });
  expect(between.text).toBe(text);
  expect(between.skills.map(s => [s.id, s.offset])).toEqual([["a", 2], [installedSkill.id, 2], ["b", 2], ["c", 5]]);
  const replaced = insertDraftSkill(text, skills, installedSkill, { selectionStart: 3, selectionEnd: 5 });
  expect(replaced.text).toBe("📦品\n说明");
  expect(replaced.skills.map(s => [s.id, s.offset])).toEqual([["a", 2], [installedSkill.id, 2], ["c", 4]]);
});

it("retains hidden skill positions when the compact input edits a multiline draft", () => {
  const skills = [{ ...installedSkill, offset: 4 }];
  expect(positionsAfterTextEdit("📦订单\n备注", "先看📦订单\n备注", skills)[0]?.offset).toBe(6);
  expect(positionsAfterTextEdit("📦订单\n备注", "📦备注", skills)[0]?.offset).toBe(2);
});
