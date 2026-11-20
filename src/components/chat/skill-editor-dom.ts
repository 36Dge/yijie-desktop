import type { ChatComposerFocusSnapshot } from "../../domain/chat-composer";
import type { SkillPosition } from "../../domain/chat-skill-placement";

type Point = { node: Node; offset: number };

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
        runs.push({ start, end: value.length, before, after });
      } else if (node instanceof HTMLBRElement) {
        // Browsers leave a final placeholder BR for the caret on an empty line.
        if (node.nextSibling) {
          text += "\n"; value += "\n";
          runs.push({ start, end: value.length, before, after });
        }
      } else if (node instanceof HTMLElement) {
        if (index && (node.tagName === "DIV" || node.tagName === "P")) {
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
