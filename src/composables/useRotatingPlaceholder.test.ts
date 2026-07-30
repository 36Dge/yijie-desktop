import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_ENTRY_PLACEHOLDERS } from "../domain/placeholder-rotation";
import {
  useRotatingPlaceholder,
  type MotionPreferenceSource,
} from "./useRotatingPlaceholder";

class MotionPreferenceStub implements MotionPreferenceSource {
  matches: boolean;
  private readonly listeners = new Set<(matches: boolean) => void>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  subscribe(listener: (matches: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) {
      listener(matches);
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

describe("useRotatingPlaceholder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("PH-005 rotates every four seconds with at most one timer", () => {
    const prompt = ref("");
    const scope = effectScope();
    const rotation = scope.run(() => useRotatingPlaceholder(prompt));

    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(vi.getTimerCount()).toBe(1);

    for (let index = 1; index < CHAT_ENTRY_PLACEHOLDERS.length; index += 1) {
      vi.advanceTimersByTime(4_000);
      expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[index]);
      expect(vi.getTimerCount()).toBe(1);
    }

    vi.advanceTimersByTime(4_000);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(vi.getTimerCount()).toBe(1);

    scope.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("PH-006 pauses for focus or input and resumes only when empty and blurred", () => {
    const prompt = ref("");
    const scope = effectScope();
    const rotation = scope.run(() => useRotatingPlaceholder(prompt));

    rotation?.onFocus();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(8_000);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);

    prompt.value = "测试输入";
    rotation?.onBlur();
    expect(vi.getTimerCount()).toBe(0);

    prompt.value = "";
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[1]);

    for (let count = 0; count < 3; count += 1) {
      rotation?.onFocus();
      rotation?.onBlur();
      expect(vi.getTimerCount()).toBe(1);
    }

    scope.stop();
  });

  it("PH-007 fixes the first placeholder for reduced motion and disposes resources", () => {
    const prompt = ref("");
    const motionPreference = new MotionPreferenceStub(true);
    const scope = effectScope();
    const rotation = scope.run(() =>
      useRotatingPlaceholder(prompt, {
        motionPreference,
      }),
    );

    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(vi.getTimerCount()).toBe(0);
    expect(motionPreference.listenerCount()).toBe(1);

    motionPreference.setMatches(false);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(4_000);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[1]);

    motionPreference.setMatches(true);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);
    expect(vi.getTimerCount()).toBe(0);

    rotation?.dispose();
    expect(motionPreference.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    motionPreference.setMatches(false);
    vi.advanceTimersByTime(8_000);
    expect(rotation?.placeholder.value).toBe(CHAT_ENTRY_PLACEHOLDERS[0]);

    scope.stop();
  });
});
