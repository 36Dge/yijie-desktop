import { onBeforeUnmount, onMounted, shallowRef, watch, type Ref } from "vue";

// A textarea does not expose its selection as a DOM Range. Measure an inert
// copy with the same wrapping, including the text after the insertion point.
function textareaCaret(input: HTMLTextAreaElement, mirror: HTMLElement): DOMRect | null {
  if (input.selectionStart !== input.selectionEnd) return null;
  const style = getComputedStyle(input);
  Object.assign(mirror.style, {
    font: style.font, lineHeight: style.lineHeight, padding: style.padding,
    letterSpacing: style.letterSpacing, wordSpacing: style.wordSpacing, tabSize: style.tabSize,
    direction: style.direction, textAlign: style.textAlign, textIndent: style.textIndent,
    whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
    width: `${input.clientWidth}px`, left: `${input.offsetLeft - input.scrollLeft}px`,
    top: `${input.offsetTop - input.scrollTop}px`,
  });
  const text = !input.value || input.value.endsWith("\n") ? input.value + "\u200b" : input.value;
  if (mirror.textContent !== text) mirror.textContent = text;
  const range = input.ownerDocument.createRange();
  range.setStart(mirror.firstChild!, input.selectionStart);
  range.collapse(true);
  return range.getBoundingClientRect();
}

function inlineCaret(editor: HTMLElement): DOMRect | null {
  const selection = editor.ownerDocument.getSelection();
  if (!selection?.isCollapsed || !selection.rangeCount || !editor.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.height) return rect;

  // WebKit reports an empty client rect for a caret at an element boundary.
  const nodes = range.startContainer.childNodes;
  const next = nodes[range.startOffset];
  let previous: Node | null = nodes[range.startOffset - 1] ?? null;
  if (previous instanceof Element && previous.matches(".inline-skill-separator")) previous = previous.previousSibling;
  if (previous instanceof HTMLElement && previous.hasAttribute("data-skill-id")) {
    const chip = previous.getBoundingClientRect();
    const x = getComputedStyle(editor).direction === "rtl" ? chip.left : chip.right;
    return new DOMRect(x, chip.top, 0, chip.height);
  }
  if (next instanceof HTMLElement && next.hasAttribute("data-skill-id")) {
    const chip = next.getBoundingClientRect();
    const x = getComputedStyle(editor).direction === "rtl" ? chip.right : chip.left;
    return new DOMRect(x, chip.top, 0, chip.height);
  }
  const text = next instanceof Text ? next : previous;
  if (text instanceof Text) {
    const edge = range.cloneRange();
    edge.setStart(text, text === next ? 0 : text.length);
    edge.collapse(true);
    return edge.getBoundingClientRect();
  }
  return next instanceof HTMLBRElement ? next.getBoundingClientRect() : null;
}

export function useChatComposerCaret(container: Ref<HTMLElement | null>, mirror: Ref<HTMLElement | null>, enabled: () => boolean) {
  const position = shallowRef<{ left: string; top: string } | null>(null);
  let frame = 0;

  function measure() {
    frame = 0;
    const host = container.value;
    const field = document.activeElement;
    if (!host || !enabled() || !document.hasFocus() || !(field instanceof HTMLElement) ||
      !field.classList.contains("chat-composer__textarea") || !host.contains(field)) {
      position.value = null;
      return;
    }
    const rect = field instanceof HTMLTextAreaElement
      ? mirror.value && textareaCaret(field, mirror.value)
      : inlineCaret(field);
    const box = host.getBoundingClientRect();
    if (!rect?.height || !box.width || !host.offsetWidth) {
      position.value = null;
      return;
    }
    const scale = box.width / host.offsetWidth;
    position.value = {
      left: `${(rect.left - box.left) / scale}px`,
      top: `${(rect.top + rect.height / 2 - box.top) / scale}px`,
    };
  }
  function refresh() {
    if (!frame && enabled() && container.value?.contains(document.activeElement)) frame = requestAnimationFrame(measure);
  }
  function hide() {
    cancelAnimationFrame(frame);
    frame = 0;
    position.value = null;
    mirror.value?.replaceChildren();
  }
  watch(enabled, active => active ? refresh() : hide(), { flush: "sync" });
  onMounted(() => {
    document.addEventListener("selectionchange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("blur", hide);
  });
  onBeforeUnmount(() => {
    hide();
    document.removeEventListener("selectionchange", refresh);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("blur", hide);
  });
  return { position, refresh, hide };
}
