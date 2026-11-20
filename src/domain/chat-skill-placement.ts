import type { SelectedChatSkill } from "./chat-skills";

export interface SkillPosition { readonly id: string; readonly offset: number }
export interface SkillSelectionRange { readonly selectionStart: number; readonly selectionEnd: number }

// DOM selections count each inline skill as one character. Stored offsets count
// only the surrounding plain text, so they can also be used on the sent message.
export function skillOffset(skill: { offset?: number }, text: string): number {
  return Math.min(text.length, Math.max(0, skill.offset ?? 0));
}

export function insertDraftSkill(text: string, skills: readonly SelectedChatSkill[], skill: SelectedChatSkill, range: SkillSelectionRange) {
  const start = Math.max(0, Math.min(range.selectionStart, text.length + skills.length));
  const end = Math.max(start, Math.min(range.selectionEnd, text.length + skills.length));
  const before: SelectedChatSkill[] = [], after: SelectedChatSkill[] = [];
  let plainStart = start, plainEnd = end;
  skills.forEach((entry, index) => {
    const position = skillOffset(entry, text) + index;
    if (position < start) { before.push(entry); plainStart--; }
    if (position < end) plainEnd--;
    else after.push(entry);
  });
  const removed = plainEnd - plainStart;
  return {
    text: text.slice(0, plainStart) + text.slice(plainEnd),
    skills: [...before, { ...skill, offset: plainStart }, ...after.map(entry => ({ ...entry, offset: skillOffset(entry, text) - removed }))],
  };
}

/** The compact clarification input edits plain text while its skill chips are hidden. */
export function positionsAfterTextEdit(before: string, after: string, skills: readonly SelectedChatSkill[]): SkillPosition[] {
  let start = 0, oldEnd = before.length, newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  return skills.map(skill => {
    const offset = skillOffset(skill, before);
    return { id: skill.id, offset: offset <= start ? offset : offset < oldEnd ? start : offset + newEnd - oldEnd };
  });
}

export function skillTextParts<T>(text: string, entries: readonly T[], offsets: readonly number[]) {
  const parts: ({ text: string; start: number } | { skill: T; start: number })[] = [];
  let start = 0;
  entries.forEach((skill, index) => {
    const offset = Math.max(start, Math.min(text.length, offsets[index] ?? 0));
    if (offset > start) parts.push({ text: text.slice(start, offset), start });
    parts.push({ skill, start: offset });
    start = offset;
  });
  if (start < text.length) parts.push({ text: text.slice(start), start });
  return parts;
}
