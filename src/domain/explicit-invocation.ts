import type { SelectedChatSkill } from "./chat-skills";
import { skillOffset, skillTextParts } from "./chat-skill-placement";
import type { ManagedSkillProjection } from "./skill-marketplace";

// Direct addresses use catalog identities. Task relevance belongs to the Runtime.
export const invocationPrefix = /^(?:(?:请|麻烦)(?:你)?(?:帮我)?|帮我|我(?:想|要))?\s*(?:先|再|然后|接着)?\s*(?:使用|选用|选择|调用|切换(?:到|为)|用|让)\s*/u;
export const invocationTaskBoundary = /^(?:$|[，,。:：]|来|帮|为我|给我|生成|制作|绘制|画|出图|处理|分析|执行|完成|准备|写|做|整理|看看)/u;
const nextSkill = /^(?:以及|和|与|、)\s*/u;
const openingQuote = /^[“「『《【"']/u;
const closingQuote = /^[”」』》】"']/u;
const quotedName = /^(?:“([^”]+)”|「([^」]+)」|『([^』]+)』|《([^》]+)》|【([^】]+)】|"([^"]+)"|'([^']+)')/u;
const normalize = (name: string) => name.normalize("NFKC").toLowerCase().trim();
const quotedText = /```[\s\S]*?(?:```|$)|`[^`\n]*`|“[^”]*”|「[^」]*」|『[^』]*』|《[^》]*》|【[^】]*】|"[^"\n]*"|'[^'\n]*'/gu;
const conditional = /^(?:如果|若|如需|如有|必要时|按需|仅当)/u;
const skillTaskBoundary = (text: string) => invocationTaskBoundary.test(text) || /^(?:协助|制定|设计|撰写|根据|针对|提供)/u.test(text);

function skillCommandTarget(input: string): string | undefined {
  const prefix = invocationPrefix.exec(input) ?? /^(?:please\s+)?(?:use|invoke|run)\s+/u.exec(input);
  if (prefix) return input.slice(prefix[0].length).trimStart();
  // A request can follow its task in the same sentence. Skip quoted examples,
  // and leave conditional or negated requests to the native model.
  const prose = input.replace(quotedText, quote => "·".repeat(quote.length));
  const command = /(?:请(?:你)?(?:帮我)?|希望你(?:能)?|并(?:且)?|这次|本轮|本次)\s*(?:先|再)?(?:调用|使用|选用)\s*/u.exec(prose);
  if (!command || /不要|无需|不必|不用|不希望|如果|若|按需/u.test(prose.slice(0, command.index))) return undefined;
  return input.slice(command.index + command[0].length).trimStart();
}

function matchSkillName(target: string, catalog: readonly ManagedSkillProjection[]) {
  const literal = target.replace(openingQuote, "").replace(/^\$/u, "");
  let length = 0;
  let rest = "";
  let matches: ManagedSkillProjection[] = [];
  for (const skill of catalog) {
    const aliases = [skill.displayName, skill.runtimeName];
    if (skill.nativeOrigin === "builtin") aliases.push(skill.id.slice(skill.id.lastIndexOf(".") + 1));
    for (const alias of aliases) {
      const name = normalize(alias);
      if (!name || name.length < length || !literal.startsWith(name)) continue;
      const suffix = literal.slice(name.length);
      if (openingQuote.test(target) && !closingQuote.test(suffix)) continue;
      const afterName = suffix.replace(closingQuote, "").trimStart();
      const tail = afterName.replace(/^(?:这个|这项)?技能\s*/u, "");
      if (tail.startsWith("的")) continue;
      if (!closingQuote.test(suffix) && !/^\s/u.test(suffix) && afterName === tail && !skillTaskBoundary(tail) && !nextSkill.test(tail)) continue;
      if (name.length > length) {
        matches = [];
        length = name.length;
        rest = tail;
      }
      if (!matches.includes(skill)) matches.push(skill);
    }
  }
  return { matches, rest };
}

export function explicitSkillInvocation(text: string, catalog: readonly ManagedSkillProjection[], picked: readonly SelectedChatSkill[]) {
  // Include the picked address when validating phrases such as “先用技能…”.
  const placed = picked.filter(skill => skill.offset !== undefined);
  if (placed.length) text = skillTextParts(text, placed, placed.map(skill => skillOffset(skill, text)))
    .map(part => "skill" in part ? `【${part.skill.runtimeName || part.skill.displayName}】` : part.text).join("");
  const mentions: ManagedSkillProjection[] = [];
  const nativeMentions: ManagedSkillProjection[] = [];
  let directed = false;
  // Native $mentions remain text, including in a sentence. Only check a known,
  // unique managed name; linked tools carry their own identity.
  if (text.includes("$")) {
    const ordinaryText = text.replace(quotedText, " ").replace(/\[\$[^\]]*\]\([^)]*\)/gu, " ");
    const names = new Set(Array.from(ordinaryText.matchAll(/\$([A-Za-z0-9_:-]+)/gu), match => match[1]));
    directed = names.size > 0;
    for (const name of names) {
      const matching = catalog.filter(skill => skill.runtimeName === name ||
        (!skill.runtimeName && skill.nativeOrigin === "builtin" && skill.id.endsWith(`.${name}`)));
      if (matching.length === 1) nativeMentions.push(matching[0]!);
    }
  }
  let addressesFirst = false;
  let issue = "";
  // Keep punctuation inside quotations and code examples out of the command grammar.
  const clauses = normalize(text).match(/(?:```[\s\S]*?(?:```|$)|`[^`\n]*`|“[^”]*”|「[^」]*」|『[^』]*』|【[^】]*】|"[^"\n]*"|'[^'\n]*'|[^,;。!?\n])+/gu) ?? [];
  for (const [index, clause] of clauses.entries()) {
    const input = clause.trim();
    if (conditional.test(input) || (index > 0 && conditional.test(clauses[index - 1]!.trim()))) continue;
    const command = skillCommandTarget(input);
    if (command !== undefined) directed = true;
    if (command === undefined && index !== 0) continue;
    let target = command ?? input;
    const afterMarker = target.replace(/^技能\s*[:：]?\s*/u, "");
    const hasMarker = command !== undefined && afterMarker !== target;
    const qualified = hasMarker && !skillTaskBoundary(afterMarker);
    if (hasMarker) target = afterMarker;
    do {
      const { matches, rest } = matchSkillName(target, catalog);
      if (!matches.length) {
        const quoted = quotedName.exec(target);
        const labeled = command !== undefined && /^([^“「『《"'\s]{1,64}?)技能(?:$|\s|来|帮我|给我)/u.exec(target);
        const namedLabel = labeled && !/(?:的|相关|合适|适合|适当|可用|必要|所需|任意|一个|这项|某个|什么|哪些)$/u.test(labeled[1]!) ? labeled[1] : undefined;
        if (qualified || namedLabel || (command !== undefined && quoted && /^\s*技能/u.test(target.slice(quoted[0].length)))) {
          const name = quoted?.slice(1).find(Boolean) ?? namedLabel;
          issue = name ? `没有找到技能“${name}”，请在「管理技能」中检查或导入。` : "没有找到指定的技能，请在「管理技能」中检查或导入。";
        }
        break;
      }
      if (command === undefined && !target.startsWith("$")) {
        const address = rest || clauses[index + 1]?.trim().replace(/^请(?:你)?\s*/u, "") || "";
        if (!skillTaskBoundary(address) && !nextSkill.test(address)) break;
      }
      if (index === 0) addressesFirst = true;
      // Canonical $names already go through Codex's own ambiguity and connector
      // checks. Only report a locally known unavailable skill for this spelling.
      if (target.startsWith("$") && !qualified) {
        break;
      }
      const chosen = matches.filter(skill => picked.some(item => item.id === skill.id));
      const enabled = matches.filter(skill => skill.installationStatus === "installed" && skill.enabled);
      const candidates = chosen.length ? chosen : (enabled.length ? enabled : matches);
      if (!chosen.length && candidates.length !== 1) {
        const name = matches[0]!.displayName;
        issue = enabled.length ? `有多个名为“${name}”的技能，请在输入框的技能列表中选择。`
          : `名为“${name}”的技能尚未启用，请在「管理技能」中安装并启用要使用的那一项。`;
        break;
      }
      for (const skill of candidates) if (!mentions.includes(skill)) mentions.push(skill);
      const separator = nextSkill.exec(rest);
      target = separator ? rest.slice(separator[0].length).replace(invocationPrefix, "") : "";
    } while (target);
  }
  return { mentions, nativeMentions, addressesFirst, directed, issue };
}
