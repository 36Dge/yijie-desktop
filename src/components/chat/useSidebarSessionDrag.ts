import { onBeforeUnmount, shallowRef, watch, type Ref } from "vue";
import type { MovePlacement } from "../../domain/sidebar-session-order";

interface DragSource {
  sessionId: string;
  group: string;
}

interface DropTarget {
  sessionId: string | null;
  group: string;
  placement: MovePlacement;
}

function groupAt(element: Element): string | undefined {
  const owner = element.closest<HTMLElement>("[data-project-group], [data-task-section]");
  return owner?.dataset.projectGroup ?? owner?.dataset.taskSection;
}

/** Use pointer capture for internal moves so native attachment file drops keep their own lifecycle. */
export function useSidebarSessionDrag(
  tree: Ref<HTMLElement | null>, enabled: Readonly<Ref<boolean>>,
  drop: (source: DragSource, target: DropTarget) => void,
) {
  const source = shallowRef<DragSource | null>(null);
  const target = shallowRef<DropTarget | null>(null);
  let press: { button: HTMLButtonElement; group: string; id: number; x: number; y: number } | null = null;
  let x = 0, y = 0, frame = 0;
  let suppressClick = false;

  function cancel() {
    const held = press;
    press = null;
    source.value = null;
    target.value = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (held) {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("lostpointercapture", cancelPointer);
      if (held.button.hasPointerCapture?.(held.id)) held.button.releasePointerCapture(held.id);
    }
  }

  function start(event: PointerEvent) {
    if (event.button !== 0 || (press && press.id !== event.pointerId)) return;
    if (press) cancel();
    suppressClick = false;
    if (!enabled.value || event.ctrlKey || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button[data-session-id]");
    const group = button && groupAt(button);
    if (!button || !group) return;
    press = { button, group, id: event.pointerId, x: event.clientX, y: event.clientY };
    button.setPointerCapture?.(event.pointerId);
    window.addEventListener("blur", cancel);
    document.addEventListener("lostpointercapture", cancelPointer);
  }

  function hitTest(): DropTarget | null {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !tree.value?.contains(hit)) return null;
    const row = hit.closest(".chat-tree__session");
    const group = groupAt(hit);
    if (!group) return null;
    const list = hit.closest(".chat-tree__sessions, .chat-tree__list");
    if (!row && list && group !== "projects" && groupAt(list) === group) {
      const rect = list.getBoundingClientRect();
      const atStart = y < rect.top + rect.height / 2;
      const edge = atStart ? list.firstElementChild : list.lastElementChild;
      const sessionId = edge?.querySelector<HTMLElement>("[data-session-id]")?.dataset.sessionId ?? null;
      return { group, sessionId, placement: atStart ? "before" : "after" };
    }
    const button = row?.querySelector<HTMLButtonElement>("[data-session-id]");
    // Dropping onto a row takes its place: before it when moving up, after it when moving down.
    const belowSource = button && press && (press.button.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    return { group, sessionId: button?.dataset.sessionId ?? null, placement: belowSource ? "after" : "before" };
  }

  function scrollAtEdge() {
    frame = 0;
    const el = tree.value;
    if (!el || !source.value) return;
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return;
    const edge = Math.min(32, rect.height / 4);
    const delta = Math.max(0, y - (rect.bottom - edge)) - Math.max(0, rect.top + edge - y);
    const previous = el.scrollTop;
    el.scrollTop += Math.sign(delta) * Math.ceil(Math.abs(delta) / 3);
    if (el.scrollTop !== previous) {
      target.value = hitTest();
      frame = requestAnimationFrame(scrollAtEdge);
    }
  }

  function move(event: PointerEvent) {
    if (!press || press.id !== event.pointerId) return;
    x = event.clientX;
    y = event.clientY;
    if (!source.value) {
      if (Math.hypot(x - press.x, y - press.y) < 5) return;
      source.value = { sessionId: press.button.dataset.sessionId!, group: press.group };
      suppressClick = true;
    }
    event.preventDefault();
    target.value = hitTest();
    if (!frame) frame = requestAnimationFrame(scrollAtEdge);
  }

  function end(event: PointerEvent) {
    if (!press || press.id !== event.pointerId) return;
    x = event.clientX;
    y = event.clientY;
    const from = source.value;
    const to = from && hitTest();
    cancel();
    if (from && to && enabled.value) drop(from, to);
  }

  function cancelPointer(event: PointerEvent) {
    if (press?.id === event.pointerId) cancel();
  }

  function captureClick(event: MouseEvent) {
    if (suppressClick && event.detail > 0) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }

  watch(enabled, allowed => { if (!allowed) cancel(); }, { flush: "sync" });
  onBeforeUnmount(cancel);
  return { source, target, start, move, end, cancel, cancelPointer, captureClick };
}
