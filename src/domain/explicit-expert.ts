import type { CatalogEntry, ExpertDisplay } from "./experts-v2.generated";
import { invocationPrefix, invocationTaskBoundary } from "./explicit-invocation";

export type ExpertInvocation =
  | { kind: "none" }
  | { kind: "ambiguous" }
  | { kind: "selected" }
  | { kind: "select"; entry: CatalogEntry };

// Text can select an expert only when the composer has no effective selection.
const shortName = /^([^，,。！？?!：:；;\n“”「」"'《》]{1,80}?专家)/u;

export function explicitExpertInvocation(text: string, entries: readonly CatalogEntry[], selected: ExpertDisplay | null): ExpertInvocation {
  if (selected) return { kind: "selected" };
  const input = text.trim().normalize("NFKC").toLowerCase();
  const prefix = invocationPrefix.exec(input);
  if (!prefix) return { kind: "none" };
  const target = input.slice(prefix[0].length);
  const named = shortName.exec(target)?.[1].trim();
  const shorthand = named && invocationTaskBoundary.test(target.slice(named.length).trimStart()) ? named : undefined;
  const matches = (expert: ExpertDisplay) => {
    const full = expert.displayName.normalize("NFKC").toLowerCase();
    if (target.startsWith(full) && invocationTaskBoundary.test(target.slice(full.length).trimStart())) return true;
    if (!shorthand) return false;
    const name = shorthand.replace(/^linkfox\s*/u, "");
    return name.length > 2 && (name === shorthand || expert.expertId.startsWith("linkfox-")) && full.endsWith(name);
  };
  const candidates = entries.filter((entry) => matches(entry.display));
  if (!shorthand && candidates.length === 0) return { kind: "none" };
  return candidates.length === 1 ? { kind: "select", entry: candidates[0] } : { kind: "ambiguous" };
}
