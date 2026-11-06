import type { CatalogEntry, ExpertDisplay } from "./experts-v2.generated";

export type ExpertInvocation =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "selected" }
  | { kind: "select"; entry: CatalogEntry };

// Only a direct request addressed to a named expert can change the binding.
// Description text, ordinary domain keywords and quoted/reported speech do not.
const invocation = /^(?:请(?:帮我)?|麻烦(?:帮我)?|帮我|我(?:想|要))?\s*(?:使用|选用|选择|调用|切换(?:到|为)|用|让)\s*/u;
const taskBoundary = /^(?:$|[，,。:：]|来|帮|为我|给我|生成|制作|绘制|画|出图|处理|分析|执行|完成|准备|写|做|整理|看看)/u;
const shortName = /^([^，,。！？?!：:；;\n“”「」"'《》]{1,80}?专家)/u;

export function explicitExpertInvocation(text: string, entries: readonly CatalogEntry[], selected: ExpertDisplay | null): ExpertInvocation {
  const input = text.trim().normalize("NFKC").toLowerCase();
  const prefix = invocation.exec(input);
  if (!prefix) return { kind: "none" };
  const target = input.slice(prefix[0].length);
  const named = shortName.exec(target)?.[1].trim();
  const shorthand = named && taskBoundary.test(target.slice(named.length).trimStart()) ? named : undefined;
  const matches = (expert: ExpertDisplay) => {
    const full = expert.displayName.normalize("NFKC").toLowerCase();
    if (target.startsWith(full) && taskBoundary.test(target.slice(full.length).trimStart())) return true;
    if (!shorthand) return false;
    const name = shorthand.replace(/^linkfox\s*/u, "");
    return name.length > 2 && (name === shorthand || expert.expertId.startsWith("linkfox-")) && full.endsWith(name);
  };
  const candidates = entries.filter((entry) => matches(entry.display));
  if (selected && matches(selected) && candidates.every(entry => entry.display.expertId === selected.expertId)) {
    // Preserve the exact historical version when the same expert is still bound.
    return { kind: "selected" };
  }
  if (!shorthand && candidates.length === 0) return { kind: "none" };
  return candidates.length === 1 ? { kind: "select", entry: candidates[0] } : { kind: "ambiguous" };
}
