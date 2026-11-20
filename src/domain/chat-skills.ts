import type { ConversationTimelineContentBlock } from "./conversation-timeline";
import type { ManagedSkillProjection } from "./skill-marketplace";
import type { SelectedSkillRef } from "./market-selection-v2.generated";
import { validateTextInput } from "../api/generated/market-selection-v2-validator.gen.js";

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

/** The pinned Runtime resolves these explicit mentions and loads their SKILL.md.
 * Keep them in the submitted text so normal persistence and retry digests retain
 * the exact per-turn intent, including model, connector and expert submissions.
 */
export function compileSkillInput(text: string, selection: readonly SelectedChatSkill[]): string {
  const names = [...new Set(selection.map(skill => skill.runtimeName))];
  if (names.some(name => !/^[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?$/.test(name))) throw new Error("Invalid skill runtime name");
  return names.length ? `${names.map(name => `$${name}`).join(" ")}\n\n${text}` : text;
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
function legacySkillMessage(
  blocks: readonly ConversationTimelineContentBlock[],
  catalog: readonly SelectedChatSkill[],
): { blocks: readonly ConversationTimelineContentBlock[]; skills: readonly SelectedChatSkill[] } {
  const unchanged = { blocks, skills: [] as readonly SelectedChatSkill[] };
  const index = blocks.findIndex(block => block.type === "text");
  const first = blocks[index];
  if (!first || first.type !== "text") return unchanged;
  const prefix = /^(\$[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?(?: \$[a-z0-9][a-z0-9-]{0,127}(?::[a-z0-9][a-z0-9-]{0,127})?)*)\n\n/.exec(first.text);
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

export type SentChatSkill = Pick<SelectedChatSkill, "id" | "displayName">;

export function presentSkillMessage(
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
    labels.set(ref.id, { id: ref.id, displayName: skill?.displayName ?? ref.id });
  }
  const legacy = legacySkillMessage(blocks, resolved);
  const samePrefix = refs.length === legacy.skills.length && refs.every((ref, index) =>
    ref.id === legacy.skills[index]?.id && ref.version === legacy.skills[index]?.version);
  return { blocks: samePrefix ? legacy.blocks : blocks, skills: [...labels.values()] };
}
