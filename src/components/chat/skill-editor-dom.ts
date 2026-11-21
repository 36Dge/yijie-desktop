import type { ChatComposerFocusSnapshot } from "../../domain/chat-composer";
import type { SkillPosition } from "../../domain/chat-skill-placement";

type Point = { node: Node; offset: number };

function startsParagraph(node: Node | null): boolean {
  return node instanceof HTMLElement && (node.tagName === "DIV" || node.tagName === "P");
}

function needsCaretSeparator(next: Node | null): boolean {
  if (next instanceof Text) return !next.length || /^[\r\n]/.test(next.data);
  return !next || next instanceof HTMLBRElement || (next instanceof HTMLElement && next.hasAttribute("data-skill-id"));
}

export function syncSkillCarets(root: HTMLElement, tokens: ReadonlyMap<string, HTMLElement>) {
  // Native editing may move a separator away from its skill. Once text can
  // carry the caret itself, drop the extra cursor stop.
  for (const separator of root.querySelectorAll(".inline-skill-separator")) {
    const previous = separator.previousSibling;
    if (!(previous instanceof HTMLElement && previous.dataset.skillId) || !needsCaretSeparator(separator.nextSibling)) {
      separator.remove();
    }
  }
  for (const token of tokens.values()) {
    if (!needsCaretSeparator(token.nextSibling)) continue;
    // A zero-size image gives WebKit a caret box at a line end or between
    // adjacent skills without inserting text into the draft or clipboard.
    const separator = root.ownerDocument.createElement("img");
    separator.className = "inline-skill-separator";
    separator.alt = "";
    separator.width = 0;
    separator.height = 0;
    separator.draggable = false;
    separator.contentEditable = "false";
    token.after(separator);
  }
}

// Read only the editable text. A non-editable skill, including all of its
// artwork and accessible labels, occupies one caret stop in the editor.
export function readSkillEditor(root: HTMLElement) {
  let text = "", value = "";
  const positions: SkillPosition[] = [];
  const tokens = new Map<string, HTMLElement>();
  const runs: { start: number; end: number; before: Point; after: Point; text?: Text }[] = [];
  const selection = root.ownerDocument.getSelection();
  let anchor: number | undefined, focus: number | undefined;
  function boundary(node: Node, offset: number) {
    if (selection?.anchorNode === node && selection.anchorOffset === offset) anchor = value.length;
    if (selection?.focusNode === node && selection.focusOffset === offset) focus = value.length;
  }
  function children(parent: Node) {
    Array.from(parent.childNodes).forEach((node, index) => {
      boundary(parent, index);
      const before = { node: parent, offset: index }, after = { node: parent, offset: index + 1 };
      const start = value.length;
      if (node instanceof Text) {
        if (selection?.anchorNode === node) anchor = start + selection.anchorOffset;
        if (selection?.focusNode === node) focus = start + selection.focusOffset;
        text += node.data;
        value += node.data;
        runs.push({ start, end: value.length, before, after, text: node });
      } else if (node instanceof HTMLElement && node.dataset.skillId) {
        const id = node.dataset.skillId;
        positions.push({ id, offset: text.length });
        tokens.set(id, node);
        value += " ";
        const next = node.nextSibling;
        const afterSkill = next instanceof Text ? { node: next, offset: 0 } : after;
        runs.push({ start, end: value.length, before, after: afterSkill });
      } else if (node instanceof HTMLBRElement) {
        // A trailing placeholder BR, including one before the next paragraph,
        // has no line break of its own.
        if (node.nextSibling && !startsParagraph(node.nextSibling)) {
          text += "\n"; value += "\n";
          runs.push({ start, end: value.length, before, after });
        }
      } else if (node instanceof HTMLElement) {
        if (index && startsParagraph(node)) {
          text += "\n"; value += "\n";
          runs.push({ start, end: value.length, before, after: { node, offset: 0 } });
        }
        children(node);
      }
    });
    boundary(parent, parent.childNodes.length);
  }
  children(root);
  const range: ChatComposerFocusSnapshot | null = anchor === undefined || focus === undefined ? null : {
    selectionStart: Math.min(anchor, focus), selectionEnd: Math.max(anchor, focus),
    selectionDirection: anchor > focus ? "backward" : anchor === focus ? "none" : "forward",
  };
  function pointAt(offset: number): Point {
    const run = runs.find(part => part.end >= offset);
    if (!run) return { node: root, offset: root.childNodes.length };
    if (run.text) return { node: run.text, offset: Math.max(0, offset - run.start) };
    return offset <= run.start ? run.before : run.after;
  }
  return { text, value, positions, tokens, range, pointAt };
}
