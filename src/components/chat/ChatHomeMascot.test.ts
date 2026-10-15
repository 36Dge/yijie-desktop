// @vitest-environment happy-dom
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import ChatHomeMascot from "./ChatHomeMascot.vue";
import type { MascotMedia } from "./home-mascot-hover-media";
const hoverFixture = vi.hoisted(() => ({ media: null as MascotMedia | null }));
vi.mock("./home-mascot-hover-media", () => ({ getAcceptedHoverMedia: () => hoverFixture.media }));

enableAutoUnmount(afterEach);
let media: MediaQueryList;
let hidden = false, now = 0, sequence = 0;
let decodeImage: () => Promise<void>;
const images: { src: string }[] = [];
const frames = new Map<number, FrameRequestCallback>();
const drawImage = vi.fn();
const clearDisplay = vi.fn();
const drawBuffer = vi.fn();
const clearBuffer = vi.fn();
let displayContext: CanvasRenderingContext2D;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  hoverFixture.media = null;
  hidden = false; now = 0; sequence = 0; images.length = 0; frames.clear();
  drawImage.mockReset(); clearDisplay.mockReset(); drawBuffer.mockReset(); clearBuffer.mockReset();
  decodeImage = () => Promise.resolve();
  media = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  displayContext = { clearRect: clearDisplay, drawImage, globalCompositeOperation: "source-over",
    getImageData: vi.fn(() => {
      const data = new Uint8ClampedArray(1070 * 594 * 4);
      for (let y = 100; y < 594; y++) for (let x = 100; x < 1000; x++) data[(y * 1070 + x) * 4 + 3] = 255;
      return { data };
    }),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValueOnce(displayContext)
    .mockReturnValue({ clearRect: clearBuffer, drawImage: drawBuffer } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("Image", class {
    src = ""; decoding = "auto";
    constructor() { images.push(this); }
    decode() { return decodeImage(); }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function advance(ms = 1000 / 24) {
  now += ms;
  const callbacks = [...frames.values()]; frames.clear();
  callbacks.forEach(callback => callback(now));
  await flushPromises();
}

describe("homepage mascot", () => {
  it("waits for the brand, presents native-resolution frames and retains the final canvas without a poster swap", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: false } });
    expect(wrapper.attributes("data-phase")).toBe("waiting"); expect(images).toHaveLength(0);
    await wrapper.setProps({ ready: true }); await flushPromises();
    expect(wrapper.attributes("data-phase")).toBe("playing"); expect(images).toHaveLength(3);
    await advance();
    expect(wrapper.attributes("data-frame")).toBe("0");
    expect(wrapper.get("canvas").attributes("width")).toBe("1070");
    expect(wrapper.get("canvas").attributes("height")).toBe("594");
    const surface = wrapper.get("canvas").element;
    await wrapper.setProps({ skipAnimation: true }); // Typing must not restart/replace a running pose.
    for (let i = 1; i < 84; i++) {
      await advance();
      expect(wrapper.attributes("data-frame")).toBe(String(i));
      expect(images.filter(image => image.src !== "").length).toBeLessThanOrEqual(3);
    }
    expect(wrapper.attributes("data-phase")).toBe("resting");
    expect(wrapper.get("canvas").element).toBe(surface);
    expect(wrapper.findAll("img")).toHaveLength(1); // Only the original awake fallback remains hidden.
    expect(wrapper.find(".home-mascot__poster--hidden").exists()).toBe(true);
    expect(images.every(image => image.src === "")).toBe(true);
    expect(frames.size).toBe(0); expect(drawImage).toHaveBeenCalledTimes(84);
    await wrapper.setProps({ ready: false, skipAnimation: false }); await wrapper.setProps({ ready: true });
    expect(wrapper.attributes("data-frame")).toBe("83"); expect(frames.size).toBe(0);
  });
  it("does not replace an unfinished pose after the old 3500ms deadline", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance(); await advance(3500);
    expect(wrapper.attributes("data-frame")).toBe("1"); expect(wrapper.attributes("data-phase")).toBe("playing");
  });
  it("prepares each full native-resolution frame offscreen before replacing the visible canvas", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance();
    const buffer = drawImage.mock.calls[0][0] as HTMLCanvasElement;
    expect(buffer).not.toBe(wrapper.get("canvas").element);
    expect([buffer.width, buffer.height]).toEqual([1070, 594]);
    expect(clearBuffer).toHaveBeenLastCalledWith(0, 0, 1070, 594);
    expect(drawBuffer).toHaveBeenLastCalledWith(images[0], 0, 0, 1070, 594, 0, 0, 1070, 594);
    expect(drawBuffer.mock.invocationCallOrder[0]).toBeLessThan(drawImage.mock.invocationCallOrder[0]);
    expect(drawImage).toHaveBeenLastCalledWith(buffer, 0, 0);
    expect(displayContext.globalCompositeOperation).toBe("copy");
    expect(clearDisplay).not.toHaveBeenCalled();
    await advance();
    expect(drawBuffer).toHaveBeenLastCalledWith(images[0], 1070, 0, 1070, 594, 0, 0, 1070, 594);
    expect(drawImage).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    expect([buffer.width, buffer.height]).toEqual([0, 0]);
  });
  it("keeps the displayed frame when preparing the next frame fails", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance();
    drawBuffer.mockImplementationOnce(() => { throw new Error("canvas draw unavailable"); });
    await advance();
    expect(wrapper.attributes("data-frame")).toBe("0");
    expect(wrapper.attributes("data-phase")).toBe("static");
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(clearDisplay).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it("does not clear the existing pose or advance when committing a prepared frame fails", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance();
    drawImage.mockImplementationOnce(() => { throw new Error("canvas commit unavailable"); });
    await advance();
    expect(wrapper.attributes("data-frame")).toBe("0");
    expect(wrapper.attributes("data-phase")).toBe("static");
    expect(clearDisplay).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
  it.each(["reduced", "draft", "hidden"])("keeps the static awake poster for %s without decoding sheets", async mode => {
    if (mode === "reduced") Object.defineProperty(media, "matches", { value: true });
    if (mode === "hidden") hidden = true;
    const wrapper = mount(ChatHomeMascot, { props: { ready: true, skipAnimation: mode === "draft" } }); await nextTick();
    expect(wrapper.attributes("data-phase")).toBe("static"); expect(images).toHaveLength(0);
    expect(wrapper.attributes("aria-hidden")).toBe("true"); expect(frames.size).toBe(0);
    expect(wrapper.findAll("button, a, [tabindex]")).toHaveLength(0);
  });
  it("freezes when hidden and resumes from the very next pose on return", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance(); await advance();
    hidden = true; document.dispatchEvent(new Event("visibilitychange")); await nextTick();
    expect(wrapper.attributes("data-phase")).toBe("paused"); expect(wrapper.attributes("data-frame")).toBe("1");
    await advance(30000); expect(frames.size).toBe(0);
    hidden = false; document.dispatchEvent(new Event("visibilitychange")); await advance();
    expect(wrapper.attributes("data-frame")).toBe("1");
    await advance(); expect(wrapper.attributes("data-frame")).toBe("2");
  });
  it("freezes the current pose when reduced motion is enabled during playback", async () => {
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    await advance(); await advance();
    Object.defineProperty(media, "matches", { value: true }); media.dispatchEvent(new Event("change")); await nextTick();
    expect(wrapper.attributes("data-phase")).toBe("static"); expect(wrapper.attributes("data-frame")).toBe("1");
    expect(frames.size).toBe(0); expect(images.every(image => image.src === "")).toBe(true);
  });
  it("shows the original poster if a sheet cannot load, with no replacement pose or input-blocking error", async () => {
    decodeImage = () => Promise.reject(new Error("image unavailable"));
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    expect(wrapper.attributes("data-phase")).toBe("static"); expect(wrapper.attributes("data-frame")).toBe("-1");
    expect(wrapper.find("[role=alert]").exists()).toBe(false); expect(frames.size).toBe(0);
  });
  it("does not start when a decode completes after leaving the homepage", async () => {
    const resolve: (() => void)[] = []; decodeImage = () => new Promise<void>(done => resolve.push(done));
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await nextTick();
    wrapper.unmount(); resolve.forEach(done => done()); await flushPromises();
    expect(frames.size).toBe(0); expect(drawImage).not.toHaveBeenCalled();
    expect(images.every(image => image.src === "")).toBe(true);
  });
});

function acceptedHover(): void {
  hoverFixture.media = { asset: { deliveryResolution: [1070, 594], frameCount: 3, fps: 24,
    playback: { columns: 2, framesPerSheet: 6, maxResidentSheets: 3, sheets: [{ file: "frames/hover-00.webp" }] },
  }, urls: ["/approved-hover-00.webp"] };
}
function move(x: number, y: number, target: EventTarget = document): void {
  target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", clientX: x, clientY: y, buttons: 0 }));
}
async function dwell(ms = 180): Promise<void> { now += ms; vi.advanceTimersByTime(ms); await flushPromises(); }
async function completeEntry() {
  const wrapper = mount(ChatHomeMascot, { props: { ready: true }, attachTo: document.body }); await flushPromises();
  const canvas = wrapper.get("canvas").element;
  canvas.style.setProperty("--yj-home-mascot-overlap", "3px");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 160, height: 594 / 1070 * 160, right: 160, bottom: 594 / 1070 * 160, toJSON: () => ({}) });
  for (let i = 0; i < 84; i++) await advance();
  return wrapper;
}
async function completeHover(): Promise<void> { for (let i = 0; i < 3; i++) await advance(); }

describe("accepted homepage hover media", () => {
  it("remains the original entrance-only component when no accepted hover clip is available", async () => {
    const wrapper = await completeEntry();
    move(80, 40); await dwell(1000);
    expect(wrapper.attributes("data-clip")).toBe("entry");
    expect(wrapper.attributes("data-frame")).toBe("83");
    expect(displayContext.getImageData).not.toHaveBeenCalled();
  });
  it("waits for dwell, plays once after real entrance completion, and finishes after leaving", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    const surface = wrapper.get("canvas").element;
    move(80, 40); await dwell(179);
    expect(wrapper.attributes("data-clip")).toBe("entry");
    await dwell(1);
    expect(wrapper.attributes("data-clip")).toBe("hover");
    expect(wrapper.attributes("data-phase")).toBe("playing");
    expect(wrapper.attributes("data-frame")).toBe("83"); // No premature poster swap while loading.
    move(200, 40);
    await completeHover();
    expect(wrapper.attributes("data-frame")).toBe("2");
    expect(wrapper.attributes("data-phase")).toBe("resting");
    expect(wrapper.get("canvas").element).toBe(surface);
    expect(clearDisplay).not.toHaveBeenCalled();
    expect(displayContext.getImageData).toHaveBeenCalledTimes(1); // Resting contour remains fixed.
  });
  it("ignores transparent padding, the input overlap and input controls", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    move(3, 3); await dwell();
    move(80, 87); await dwell();
    const input = document.createElement("textarea"); document.body.append(input);
    move(80, 40, input); await dwell(); input.remove();
    expect(wrapper.attributes("data-clip")).toBe("entry");
    move(200, 40); move(80, 40); await dwell();
    expect(wrapper.attributes("data-clip")).toBe("hover");
  });
  it("requires a fresh entry when the entrance ends beneath an already stationary pointer", async () => {
    acceptedHover();
    const wrapper = mount(ChatHomeMascot, { props: { ready: true } }); await flushPromises();
    const canvas = wrapper.get("canvas").element;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 160, height: 89 } as DOMRect);
    move(80, 40);
    for (let i = 0; i < 84; i++) await advance();
    await dwell(1000);
    expect(wrapper.attributes("data-clip")).toBe("entry");
    move(200, 40); move(80, 40); await dwell();
    expect(wrapper.attributes("data-clip")).toBe("hover");
  });
  it("uses actual completion for cooldown and does not replay while the pointer stays inside", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    move(80, 40); await dwell(); await completeHover();
    const count = drawImage.mock.calls.length;
    await dwell(10000); move(81, 40); await dwell();
    expect(drawImage).toHaveBeenCalledTimes(count);
    move(200, 40); move(80, 40); await dwell(); await completeHover();
    expect(drawImage).toHaveBeenCalledTimes(count + 3);
    move(200, 40); await dwell(4999); move(80, 40); await dwell(1000);
    expect(wrapper.attributes("data-phase")).toBe("resting");
    expect(drawImage).toHaveBeenCalledTimes(count + 3);
    move(200, 40); move(80, 40); await dwell();
    expect(wrapper.attributes("data-phase")).toBe("playing");
  });
  it("pauses a hover in the background and resumes its next frame without a new performance", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    move(80, 40); await dwell(); await advance();
    hidden = true; document.dispatchEvent(new Event("visibilitychange")); await nextTick();
    expect(wrapper.attributes("data-phase")).toBe("paused");
    move(200, 40); move(80, 40); await dwell(10000);
    expect(wrapper.attributes("data-frame")).toBe("0");
    hidden = false; document.dispatchEvent(new Event("visibilitychange")); await advance();
    expect(wrapper.attributes("data-frame")).toBe("0");
    await advance(); expect(wrapper.attributes("data-frame")).toBe("1");
    await advance(); expect(wrapper.attributes("data-frame")).toBe("2");
    expect(wrapper.attributes("data-phase")).toBe("resting");
  });
  it("freezes the current valid hover frame and disables further hover when reduced motion is enabled", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    move(80, 40); await dwell(); await advance();
    Object.defineProperty(media, "matches", { value: true }); media.dispatchEvent(new Event("change")); await nextTick();
    const count = drawImage.mock.calls.length;
    move(200, 40); move(80, 40); await dwell(10000); await advance();
    expect(wrapper.attributes("data-phase")).toBe("static");
    expect(wrapper.attributes("data-frame")).toBe("0");
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(clearDisplay).not.toHaveBeenCalled();
  });
  it("keeps the valid resting frame when hover media cannot decode", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    const count = drawImage.mock.calls.length;
    decodeImage = () => Promise.reject(new Error("hover media unavailable"));
    move(80, 40); await dwell(); await advance();
    expect(wrapper.attributes("data-phase")).toBe("static");
    expect(wrapper.attributes("data-frame")).toBe("83");
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(clearDisplay).not.toHaveBeenCalled();
  });
  it("keeps the same canvas and last valid hover pose when preparing a later frame fails", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    const surface = wrapper.get("canvas").element;
    move(80, 40); await dwell(); await advance();
    const count = drawImage.mock.calls.length;
    drawBuffer.mockImplementationOnce(() => { throw new Error("hover frame unavailable"); });
    await advance();
    expect(wrapper.attributes("data-phase")).toBe("static");
    expect(wrapper.attributes("data-frame")).toBe("0");
    expect(wrapper.get("canvas").element).toBe(surface);
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(clearDisplay).not.toHaveBeenCalled();
    move(200, 40); move(80, 40); await dwell(10000); await advance();
    expect(drawImage).toHaveBeenCalledTimes(count);
  });
  it("does not misinterpret a later draft skip flag as the reduced-motion preference", async () => {
    acceptedHover(); const wrapper = await completeEntry();
    await wrapper.setProps({ skipAnimation: true });
    move(80, 40); await dwell();
    expect(wrapper.attributes("data-phase")).toBe("playing");
    expect(wrapper.attributes("data-clip")).toBe("hover");
  });
  it("removes listeners and cancels a pending dwell when unmounted", async () => {
    acceptedHover(); const removed = vi.spyOn(document, "removeEventListener");
    const wrapper = await completeEntry();
    move(80, 40); await dwell(90); wrapper.unmount();
    const count = drawImage.mock.calls.length;
    move(200, 40); move(80, 40); await dwell(1000); await advance();
    expect(drawImage).toHaveBeenCalledTimes(count);
    expect(removed.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(["pointermove", "pointerleave", "visibilitychange"]));
  });
});
