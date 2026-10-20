import type { ConversationTimelineContentBlock } from "./conversation-timeline";
import type { ManagedSkillProjection } from "./skill-marketplace";

export interface SelectedChatSkill {
  readonly id: string;
  readonly runtimeName: string;
  readonly displayName: string;
  readonly category: ManagedSkillProjection["category"];
}

export interface ChatSkillChip extends SelectedChatSkill {
  readonly unavailableReason: string | null;
}

export function skillSelectionIssue(skill: ManagedSkillProjection | undefined): string | null {
  if (!skill || skill.installationStatus !== "installed") return "技能已卸载，请重新安装";
  if (skill.catalogStatus !== "installable" || skill.failureCode !== "") return "技能暂不可用，请在管理技能中检查";
  if (!skill.enabled) return "技能已停用，请在管理技能中启用";
  if (!skill.runtimeVisible) return "技能尚未就绪，请稍后重试";
  return null;
}

export function selectedSkillIssue(selected: SelectedChatSkill, catalog: readonly ManagedSkillProjection[]): string | null {
  const current = catalog.find(skill => skill.id === selected.id);
  if (current && current.runtimeName !== selected.runtimeName) return "技能已更新，请重新选择";
  return skillSelectionIssue(current);
}

/** The pinned Runtime resolves these explicit mentions and loads their SKILL.md.
 * Keep them in the submitted text so normal persistence and retry digests retain
 * the exact per-turn intent, including model, connector and expert submissions.
 */
export function compileSkillInput(text: string, selection: readonly SelectedChatSkill[]): string {
  const names = [...new Set(selection.map(skill => skill.runtimeName))];
  if (names.some(name => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name))) throw new Error("Invalid skill runtime name");
  return names.length ? `${names.map(name => `$${name}`).join(" ")}\n\n${text}` : text;
}


/** Presentation only: retain the original blocks for copy, retry and Runtime.
 * Only the complete, canonical leading mention line is eligible for display.
 * Unknown/ambiguous names and prose containing dollar signs stay literal.
 */
export function presentSkillMessage(
  blocks: readonly ConversationTimelineContentBlock[],
  catalog: readonly SelectedChatSkill[],
): { blocks: readonly ConversationTimelineContentBlock[]; skills: readonly SelectedChatSkill[] } {
  const unchanged = { blocks, skills: [] as readonly SelectedChatSkill[] };
  const index = blocks.findIndex(block => block.type === "text");
  const first = blocks[index];
  if (!first || first.type !== "text") return unchanged;
  const prefix = /^(\$[a-z0-9][a-z0-9-]{0,63}(?: \$[a-z0-9][a-z0-9-]{0,63})*)\n\n/.exec(first.text);
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
