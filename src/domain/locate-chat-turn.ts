/** Bounded reads through the existing authorized history pager. No synthetic turn. */
export async function locateChatTurn(input: {
  current(): boolean; found(): boolean; cursor(): string | null | undefined;
  loadOlder(): Promise<void>;
}, pages = 10): Promise<"found" | "unavailable" | "more" | "superseded"> {
  for (let count = 0; count <= pages; count++) {
    if (!input.current()) return "superseded";
    if (input.found()) return "found";
    const cursor = input.cursor();
    if (!cursor) return "unavailable";
    if (count === pages) return "more";
    await input.loadOlder();
    if (input.current() && input.cursor() === cursor && !input.found()) return "unavailable";
  }
  return "more";
}
