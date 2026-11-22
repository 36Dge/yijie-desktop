import type { ConversationTimelineContentBlock } from "./conversation-timeline";
import type { ManagedSkillProjection } from "./skill-marketplace";
import type { SelectedSkillRef } from "./market-selection-v2.generated";
import { validateTextInput } from "../api/generated/market-selection-v2-validator.gen.js";
import { skillOffset } from "./chat-skill-placement";
import { explicitSkillInvocation } from "./explicit-invocation";

// Set only by the fixed entry after both native/Host source pins are admitted.
export function nativeSkillInputEnabled(): boolean {
  return import.meta.env.VITE_YIJIE_NATIVE_SKILL_INPUT_ENABLED === "true";
}

export interface SelectedChatSkill {
  readonly id: string;
  readonly version: string;
  readonly runtimeName: string;
  readonly displayName: string;
  readonly category: ManagedSkillProjection["category"];
  /** UTF-16 offset in the draft's plain text. Older selections precede the text. */
  readonly offset?: number;
}

export interface ChatSkillChip extends SelectedChatSkill {
  readonly unavailableReason: string | null;
}

export interface ChatSkillSuggestionCatalog {
  readonly entries: readonly ManagedSkillProjection[];
  readonly disabled: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

export function matchingChatSkills(entries: readonly ManagedSkillProjection[], query: string): readonly ManagedSkillProjection[] {
  const search = query.trim().toLocaleLowerCase();
  return search
    ? entries.filter(entry => `${entry.displayName} ${entry.description} ${entry.runtimeName}`.toLocaleLowerCase().includes(search))
    : entries;
}

export function chatSkillSlashQuery(beforeCaret: string, entries: readonly ManagedSkillProjection[]) {
  const start = beforeCaret.lastIndexOf("/");
  if (start < 0) return null;
  // Chinese prose often has no space before the slash. Keep URLs, paths and
  // expressions such as 1/2 available for ordinary text entry.
  const precedingWord = beforeCaret.slice(0, start).split(/[\s，。！？：；、（]/u).pop();
  if (precedingWord && (!/\p{Script=Han}$/u.test(precedingWord) || /[/\\]/u.test(precedingWord))) return null;
  const query = beforeCaret.slice(start + 1);
  if (/^\s|[\r\n]/u.test(query)) return null;
  // Allow a space within a matching name such as “电商 SEO 优化”.
  if (/\s/u.test(query) && !matchingChatSkills(entries, query).length) return null;
  return { start, end: beforeCaret.length, query };
}

export function skillSelectionIssue(skill: ManagedSkillProjection | undefined): string | null {
  if (!skill) return "技能已卸载，请重新安装";
  if (skill.installationStatus === "not_installed") return "技能尚未安装，请在管理技能中安装";
  if (skill.installationStatus === "installing" || skill.installationStatus === "uninstalling") return "技能正在更新，请稍后重试";
  if (skill.installationStatus !== "installed") return "技能状态待核对，请在管理技能中检查";
  if (skill.catalogStatus !== "installable" || skill.failureCode !== "") return "技能暂不可用，请在管理技能中检查";
  if (!skill.enabled) return "技能已停用，请在管理技能中启用";
  if (!skill.runtimeVisible) return "技能尚未就绪，请稍后重试";
  return null;
}

export function selectedSkillIssue(selected: SelectedChatSkill, catalog: readonly ManagedSkillProjection[]): string | null {
  const current = catalog.find(skill => skill.id === selected.id);
  const issue = skillSelectionIssue(current);
  if (issue || !current) return issue;
  if (current.runtimeName !== selected.runtimeName || (nativeSkillInputEnabled() && current.version !== selected.version)) return "技能已更新，请重新选择";
  return null;
}

export function namedSkillIssue(displayName: string, issue: string): string {
  return `技能“${displayName}”${issue.replace(/^技能/u, "")}。`;
}

/** The catalog reports one state for all dependencies. Attribute it to a
 * particular tool only when the skill declares exactly one. */
export function skillInvocationToolNotice(skill: ManagedSkillProjection): string | null {
  const state = skill.dependencyState;
  if (state !== "missing" && state !== "needs_authorization") return null;
  const target = skill.requiredTools.length === 1 ? `所需的工具「${skill.requiredTools[0]}」` : "有必备工具";
  const condition = state === "missing" ? "尚未接入，相关步骤需要先连接相应服务" : "尚未授权，相关步骤需要先在相应服务中完成授权";
  const declarations = skill.requiredTools.length > 1 ? `该技能声明使用${skill.requiredTools.map(name => `「${name}」`).join("、")}，目录只提供整体检查结果。` : "";
  return `「${skill.displayName}」${target}${condition}。${declarations}`;
}

const legacySkillName = /^[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?$/;

/** The pinned Runtime resolves these explicit mentions and loads their SKILL.md.
 * Keep them in the submitted text so normal persistence and retry digests retain
 * the exact per-turn intent, including model, connector and expert submissions.
 */
export function compileSkillInput(text: string, selection: readonly SelectedChatSkill[]): string {
  const names = [...new Set(selection.map(skill => skill.runtimeName))];
  if (names.some(name => !legacySkillName.test(name))) throw new Error("Invalid skill runtime name");
  return names.length ? `${names.map(name => `$${name}`).join(" ")}\n\n${text}` : text;
}

export interface SubmittedSkillText {
  readonly text: string;
  /** Start of each generated marker in the submitted text, in selection order. */
  readonly markerStarts: readonly number[];
  /** Length of a generated legacy $mention header, including its blank line. */
  readonly prefixLength?: number;
}

export interface SkillMessagePlacement {
  readonly offsets: readonly number[];
  readonly pickedCount?: number;
  readonly prefixLength?: number;
}

function skillMarkerName(skill: SelectedChatSkill): string {
  if (/^[a-zA-Z0-9_:-]{1,512}$/.test(skill.runtimeName)) return `$${skill.runtimeName}`;
  // Native structured inputs can also identify a skill without a plain $name.
  return JSON.stringify(skill.runtimeName || skill.displayName).replace(/\$/g, "\\u0024");
}

export function prepareSkillText(draft: string, selection: readonly SelectedChatSkill[], legacyMentions: boolean): SubmittedSkillText {
  const markerStarts = selection.map(() => -1);
  // A skill-only turn still needs a text block for the native submission. Keep
  // a visible marker even for an older draft whose selection has no offset.
  const skillOnly = selection.length > 0 && !draft.trim();
  const placed = selection.flatMap((skill, index) =>
    skill.offset !== undefined || legacyMentions || skillOnly ? [{ skill, index, offset: skillOffset(skill, draft) }] : []
  ).sort((a, b) => a.offset - b.offset);
  // The compatibility renderer already understands a leading group. Keep that
  // spelling when every selection belongs before the very first character.
  if (!placed.length || (!skillOnly && legacyMentions && placed.every(entry => entry.offset === 0))) {
    const body = selection.some(skill => skill.offset !== undefined) ? draft : draft.trim();
    const text = legacyMentions ? compileSkillInput(body, selection).trim() : draft.trim();
    return { text, markerStarts, ...(legacyMentions && selection.length > 0 && { prefixLength: text.indexOf("\n\n") + 2 }) };
  }
  let text = "", cursor = 0;
  for (const { skill, index, offset } of placed) {
    const name = skillMarkerName(skill);
    if (legacyMentions && !legacySkillName.test(skill.runtimeName)) throw new Error("Invalid skill runtime name");
    text += draft.slice(cursor, offset);
    markerStarts[index] = text.length;
    text += `【技能${index + 1} ${name}】`;
    cursor = offset;
  }
  text += draft.slice(cursor);
  const leading = text.length - text.trimStart().length;
  return { text: text.trim(), markerStarts: markerStarts.map(start => start < 0 ? -1 : start - leading) };
}

export function compileSelectedSkillRefs(selection: readonly SelectedChatSkill[]): readonly SelectedSkillRef[] {
  if (selection.length === 0) return [];
  const values = selection.map(({ id, version }) => Object.freeze({ id, version }));
  if (new Set(values.map(value => value.id)).size !== values.length || !validateTextInput({ type: "text", text: "selection", skills: values })) {
    throw new Error("Invalid selected Skill identity");
  }
  return Object.freeze(values);
}


/** Presentation only: retain the original blocks for copy, retry and Runtime.
 * Only the complete, canonical leading mention line is eligible for display.
 * Unknown/ambiguous names and prose containing dollar signs stay literal.
 */
const legacySkillPrefix = /^(\$[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?(?: \$[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?)*)\n\n/;

function legacySkillMessage(
  blocks: readonly ConversationTimelineContentBlock[],
  catalog: readonly SelectedChatSkill[],
): { blocks: readonly ConversationTimelineContentBlock[]; skills: readonly SelectedChatSkill[] } {
  const unchanged = { blocks, skills: [] as readonly SelectedChatSkill[] };
  const index = blocks.findIndex(block => block.type === "text");
  const first = blocks[index];
  if (!first || first.type !== "text") return unchanged;
  const prefix = legacySkillPrefix.exec(first.text);
  if (!prefix) return unchanged;
  const names = [...new Set(prefix[1]!.split(" ").map(name => name.slice(1)))];
  const selected: SelectedChatSkill[] = [];
  for (const name of names) {
    const matches = catalog.filter(skill => skill.runtimeName === name);
    if (matches.length !== 1) return unchanged;
    selected.push(matches[0]!);
  }
  return {
    skills: selected,
    blocks: blocks.map((block, position) => position === index ? { ...first, text: first.text.slice(prefix[0].length) } : block),
  };
}

export type SentChatSkill = Pick<SelectedChatSkill, "id" | "displayName"> & Partial<Pick<SelectedChatSkill, "category">>;
export type PositionedChatSkill = SentChatSkill & { readonly offset: number };

interface BubbleSkill {
  readonly index: number;
  readonly skill: SentChatSkill;
  offset?: number;
}

interface PresentedSkillMessage {
  blocks: readonly ConversationTimelineContentBlock[];
  skills: readonly SentChatSkill[];
  offsets?: readonly number[];
}

function pickerPresentation(
  blocks: readonly ConversationTimelineContentBlock[], entries: readonly BubbleSkill[],
  catalog: readonly SelectedChatSkill[], pickedCount?: number,
): PresentedSkillMessage {
  let visible = entries;
  if (pickedCount !== undefined) {
    visible = entries.filter(entry => entry.index < pickedCount);
  } else if (entries.some(entry => entry.offset === undefined)) {
    // Older turns saved picker choices and text invocations in one list.
    // A marker or a saved caret position takes precedence over the prose.
    const prose = blocks.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
    const named = new Set(explicitSkillInvocation(prose, catalog, []).mentions.map(skill => skill.id));
    visible = entries.filter(entry => entry.offset !== undefined || !named.has(entry.skill.id));
  }
  return {
    blocks, skills: visible.map(entry => entry.skill),
    ...(visible.some(entry => entry.offset !== undefined) && { offsets: visible.map(entry => entry.offset ?? 0) }),
  };
}

function unpositionedSkillMessage(
  blocks: readonly ConversationTimelineContentBlock[],
  catalog: readonly SelectedChatSkill[],
): { blocks: readonly ConversationTimelineContentBlock[]; skills: readonly SentChatSkill[] } {
  const refs = blocks.flatMap(block => block.type === "text" ? block.skills ?? [] : []);
  if (!refs.length) return legacySkillMessage(blocks, catalog);
  const labels = new Map<string, SentChatSkill>();
  const resolved: SelectedChatSkill[] = [];
  for (const ref of refs) {
    if (labels.has(ref.id)) continue;
    const skill = catalog.find(entry => entry.id === ref.id && entry.version === ref.version);
    if (skill) resolved.push(skill);
    labels.set(ref.id, { id: ref.id, displayName: skill?.displayName ?? ref.id, ...(skill && { category: skill.category }) });
  }
  const legacy = legacySkillMessage(blocks, resolved);
  const samePrefix = refs.length === legacy.skills.length && refs.every((ref, index) =>
    ref.id === legacy.skills[index]?.id && ref.version === legacy.skills[index]?.version);
  return { blocks: samePrefix ? legacy.blocks : blocks, skills: [...labels.values()] };
}

export function presentSkillMessage(
  blocks: readonly ConversationTimelineContentBlock[], catalog: readonly SelectedChatSkill[], placement?: SkillMessagePlacement,
): PresentedSkillMessage {
  const markerStarts = placement?.offsets;
  const pickedCount = placement?.pickedCount;
  if (pickedCount === 0 && !markerStarts?.length) return { blocks, skills: [] };
  const first = blocks.find(block => block.type === "text");
  function unpositioned() {
    const message = unpositionedSkillMessage(blocks, catalog);
    let body = message.blocks;
    if (pickedCount !== undefined && markerStarts?.length && first?.type === "text") {
      const prefix = placement?.prefixLength;
      body = prefix && legacySkillPrefix.exec(first.text)?.[0].length === prefix
        ? blocks.map(block => block === first ? { ...first, text: first.text.slice(prefix) } : block) : blocks;
    }
    return pickerPresentation(body, message.skills.map((skill, index) => ({ skill, index })), catalog, pickedCount);
  }
  if (!first || first.type !== "text" || !first.text.includes("【技能") || (!first.skills?.length && !markerStarts)) {
    return unpositioned();
  }
  const refs = first.skills ?? [];
  const savedRefs = blocks.flatMap(block => block.type === "text" ? block.skills ?? [] : []);
  const entries: BubbleSkill[] = savedRefs.map((ref, index) => ({ index,
    skill: catalog.find(skill => skill.id === ref.id && skill.version === ref.version) ?? { id: ref.id, displayName: ref.id },
  }));
  const matches = [...first.text.matchAll(/【技能([1-9]\d{0,2}) (\$[a-zA-Z0-9_:-]{1,512}|"(?:[^"\\]|\\.)*")】/gu)];
  const counts = new Map<number, number>();
  for (const match of matches) {
    const index = Number(match[1]) - 1;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  let cursor = 0, text = "";
  for (const match of matches) {
    const index = Number(match[1]) - 1, start = match.index!;
    // The receipt distinguishes a picked chip from an identical user-typed
    // example. Without it, only an unambiguous saved selection is eligible.
    if (markerStarts ? markerStarts[index] !== start : counts.get(index) !== 1) continue;
    const selected = refs[index];
    if (refs.length && !selected) continue;
    let entry: BubbleSkill | undefined;
    if (selected) {
      const known = catalog.find(skill => skill.id === selected.id && skill.version === selected.version);
      if (known && skillMarkerName(known) !== match[2] && !markerStarts) continue;
      entry = entries[index];
    } else {
      const candidates = catalog.filter(skill => skillMarkerName(skill) === match[2]);
      if (candidates.length === 1) {
        entry = { index, skill: candidates[0]! };
        entries.push(entry);
      } else if (pickedCount === undefined || index < pickedCount) continue;
    }
    text += first.text.slice(cursor, start);
    if (entry) entry.offset = text.length;
    cursor = start + match[0].length;
  }
  if (!cursor) return unpositioned();
  text += first.text.slice(cursor);
  return pickerPresentation(blocks.map(block => block === first ? { ...first, text } : block), entries, catalog, pickedCount);
}
