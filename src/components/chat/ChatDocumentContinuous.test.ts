// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import script from "../../../src-tauri/src/chat/document_preview_continuous.js?raw";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

function reader(restoreY = 0) {
  document.body.innerHTML = '<main id="document-pages"><article class="document-page" data-index="0" data-state="ready" data-more="true"><p>Page 0</p></article></main><p id="document-stream-status"></p>';
  let top = 0;
  const root = document.getElementById("document-pages")!;
  const frames: FrameRequestCallback[] = [];
  const listeners = new Map<string, () => void>();
  const ipc = { postMessage: vi.fn() };
  const view = {
    ipc,
    __yijieDocumentRestore: { x: 0, y: restoreY },
    __yijieDocumentPage: (_payload: unknown) => { void _payload; },
    scrollTo: vi.fn((_x: number, y: number) => { top = y; }),
  };
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(() => root.children.length * 1200);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const y = Number(this.dataset.index) * 1200 - top;
    return { x: 0, y, top: y, bottom: y + 1200, left: 0, right: 336, width: 336, height: 1200, toJSON: () => ({}) };
  });
  const run = new Function("window", "document", "innerHeight", "requestAnimationFrame", "addEventListener", script);
  run(view, document, 600, (callback: FrameRequestCallback) => frames.push(callback), (name: string, callback: () => void) => listeners.set(name, callback));
  const frame = () => { const callbacks = frames.splice(0); callbacks.forEach(callback => callback(0)); };
  return {
    root, view, ipc, frame,
    scroll(y: number) { top = y; listeners.get("scroll")!(); frame(); },
    receive(index: number, more = true) { view.__yijieDocumentPage({ index, html: `<p>Page ${index}</p>`, more }); frame(); },
  };
}

it("loads subsequent chunks by scrolling and restores released earlier content", () => {
  const r = reader(); r.frame();
  expect(r.ipc.postMessage).toHaveBeenLastCalledWith('{"page":1}');
  r.receive(1);
  expect(r.root.textContent).toContain("Page 1");
  r.scroll(2400);
  expect(r.ipc.postMessage).toHaveBeenLastCalledWith('{"page":2}');
  expect(r.root.children[0]!.textContent).toBe("");
  expect((r.root.children[0] as HTMLElement).style.height).toBe("1200px");
  r.receive(2); r.receive(3, false);
  r.scroll(0);
  expect(r.ipc.postMessage).toHaveBeenLastCalledWith('{"page":0}');
  r.receive(0);
  expect(r.root.children[0]!.textContent).toBe("Page 0");
  expect(r.root.children).toHaveLength(4);
  expect(r.root.querySelectorAll("button,select")).toHaveLength(0);
});

it("reconstructs the saved scroll range before restoring a later reading position", () => {
  const r = reader(4800); r.frame();
  for (let index = 1; index <= 4; index++) {
    expect(r.ipc.postMessage).toHaveBeenLastCalledWith(JSON.stringify({ page: index }));
    r.receive(index, index < 4);
  }
  expect(r.view.scrollTo).toHaveBeenLastCalledWith(0, 4800);
  expect(r.root.textContent).toContain("Page 4");
  expect(r.ipc.postMessage).toHaveBeenLastCalledWith('{"page":3}');
  r.receive(3);
  expect(r.root.querySelectorAll('[data-state="ready"]').length).toBeLessThanOrEqual(4);
  expect(document.getElementById("document-stream-status")!.textContent).toBe("");
});
