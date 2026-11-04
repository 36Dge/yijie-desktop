/**
 * Read-only cleanup for saved commentary produced by the first declaration
 * candidate. This never creates messages, infers phases or mutates stored text.
 * Reserved standalone transport lines are hidden; quoted/code examples remain.
 */
export function readablePublicCommentary(text: string): string {
  if (!text.includes("[[yijie.public-message.v1:")) return text;
  let fence: { marker: string; length: number } | null = null;
  let result = "";
  for (const line of text.match(/[^\n]*\n|[^\n]+$/gu) ?? []) {
    const value = line.replace(/\r?\n$/u, "");
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(value);
    if (fence) {
      if (boundary?.[1]?.[0] === fence.marker && boundary[1].length >= fence.length && !boundary[2]?.trim()) fence = null;
      result += line;
      continue;
    }
    if (boundary && (boundary[1]![0] !== "`" || !boundary[2]!.includes("`"))) {
      fence = { marker: boundary[1]![0]!, length: boundary[1]!.length };
      result += line;
      continue;
    }
    if (value.length <= 128 && /^ {0,3}\[\[yijie\.public-message\.v1:(?:commentary|final_answer)\]\][ \t\r]*$/u.test(value)) continue;
    result += line;
  }
  return result;
}
