import { flushPromises } from "@vue/test-utils";
import { vi } from "vitest";

// Ordinary browser load/decode events; no network, resource injection or native
// process manipulation. Native authorization is tested through typed clients.
export function installArtifactMediaDom() {
  const images: HTMLImageElement[] = [], videos: HTMLVideoElement[] = [];
  const decoded = new WeakSet<Element>();
  const playing = new WeakSet<HTMLMediaElement>();
  const draws = new Map<HTMLCanvasElement, ReturnType<typeof vi.fn>>();
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options);
    if (element instanceof HTMLImageElement) images.push(element);
    if (element instanceof HTMLVideoElement) {
      Object.defineProperties(element, { videoWidth: { value: 1280 }, videoHeight: { value: 720 } });
      videos.push(element);
    }
    return element;
  }) as typeof document.createElement);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  function startPlayback(element: HTMLMediaElement) {
    playing.add(element);
    element.dispatchEvent(new Event("play"));
    if (playing.has(element)) element.dispatchEvent(new Event("playing"));
  }
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(function (this: HTMLMediaElement) { return !playing.has(this); });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { playing.delete(this); });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) { playing.delete(this); });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async function (this: HTMLMediaElement) { startPlayback(this); });
  vi.spyOn(HTMLMediaElement.prototype, "duration", "get").mockReturnValue(12);
  vi.spyOn(HTMLMediaElement.prototype, "readyState", "get").mockReturnValue(2);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    if (!draws.has(this)) draws.set(this, vi.fn());
    return { drawImage: draws.get(this)! } as unknown as CanvasRenderingContext2D;
  });
  function complete(element: HTMLImageElement | HTMLVideoElement) {
    decoded.add(element);
    if (element instanceof HTMLVideoElement) {
      element.dispatchEvent(new Event("loadedmetadata"));
      element.dispatchEvent(new Event("seeked"));
    } else element.dispatchEvent(new Event("load"));
  }
  async function decodeAll() {
    for (let pass = 0; pass < 8; pass++) {
      await flushPromises();
      const pending = [...images, ...videos].filter(element => element.getAttribute("src") && !decoded.has(element));
      if (!pending.length) break;
      pending.forEach(complete);
    }
    await flushPromises();
  }
  return { images, videos, complete, decodeAll, startPlayback, draws };
}
