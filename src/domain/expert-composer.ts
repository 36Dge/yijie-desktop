import type { CatalogEntry } from "./experts.generated";

/** The catalog's first non-empty quick question is the editable starting prompt.
 * Keep the original text; shortened presentation labels are not sendable copy. */
export function expertDefaultPrompt(entry: CatalogEntry): string {
  return entry.quickPrompts.find(prompt => prompt.trim().length > 0)
    ?? `请以${entry.display.displayName}的专业视角，先确认我的任务目标和所需资料，再给出具体方案。`;
}
