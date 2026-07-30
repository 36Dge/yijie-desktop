import {
  computed,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type Ref,
  type WatchStopHandle,
} from "vue";
import {
  PLACEHOLDER_ROTATION_INTERVAL_MS,
  nextPlaceholderIndex,
  placeholderAt,
  shouldRotatePlaceholder,
} from "../domain/placeholder-rotation";

export interface MotionPreferenceSource {
  readonly matches: boolean;
  subscribe(listener: (matches: boolean) => void): () => void;
}

export interface RotatingPlaceholderOptions {
  motionPreference?: MotionPreferenceSource;
  intervalMs?: number;
}

export interface RotatingPlaceholder {
  placeholder: ComputedRef<string>;
  placeholderIndex: Readonly<Ref<number>>;
  isFocused: Readonly<Ref<boolean>>;
  onFocus: () => void;
  onBlur: () => void;
  dispose: () => void;
}

function createSystemMotionPreference(): MotionPreferenceSource | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined;
  }

  const query = window.matchMedia("(prefers-reduced-motion: reduce)");

  return {
    get matches() {
      return query.matches;
    },
    subscribe(listener) {
      const handleChange = (event: MediaQueryListEvent) => listener(event.matches);
      query.addEventListener("change", handleChange);
      return () => query.removeEventListener("change", handleChange);
    },
  };
}

export function useRotatingPlaceholder(
  value: Ref<string>,
  options: RotatingPlaceholderOptions = {},
): RotatingPlaceholder {
  const motionPreference = options.motionPreference ?? createSystemMotionPreference();
  const intervalMs = options.intervalMs ?? PLACEHOLDER_ROTATION_INTERVAL_MS;
  const placeholderIndex = ref(0);
  const isFocused = ref(false);
  const prefersReducedMotion = ref(motionPreference?.matches ?? false);
  const placeholder = computed(() => placeholderAt(placeholderIndex.value));

  let intervalHandle: ReturnType<typeof globalThis.setInterval> | undefined;
  let stopWatching: WatchStopHandle | undefined;
  let unsubscribeMotionPreference: (() => void) | undefined;
  let isDisposed = false;

  function stopRotation(): void {
    if (intervalHandle === undefined) {
      return;
    }

    globalThis.clearInterval(intervalHandle);
    intervalHandle = undefined;
  }

  function syncRotation(): void {
    if (prefersReducedMotion.value) {
      placeholderIndex.value = 0;
    }

    const shouldRotate = shouldRotatePlaceholder({
      value: value.value,
      isFocused: isFocused.value,
      prefersReducedMotion: prefersReducedMotion.value,
      isDisposed,
    });

    if (!shouldRotate) {
      stopRotation();
      return;
    }

    if (intervalHandle !== undefined) {
      return;
    }

    intervalHandle = globalThis.setInterval(() => {
      placeholderIndex.value = nextPlaceholderIndex(placeholderIndex.value);
    }, intervalMs);
  }

  function onFocus(): void {
    isFocused.value = true;
  }

  function onBlur(): void {
    isFocused.value = false;
  }

  function dispose(): void {
    if (isDisposed) {
      return;
    }

    isDisposed = true;
    stopRotation();
    stopWatching?.();
    unsubscribeMotionPreference?.();
    stopWatching = undefined;
    unsubscribeMotionPreference = undefined;
  }

  stopWatching = watch([value, isFocused, prefersReducedMotion], syncRotation, {
    flush: "sync",
  });

  unsubscribeMotionPreference = motionPreference?.subscribe((matches) => {
    prefersReducedMotion.value = matches;
  });

  syncRotation();
  onScopeDispose(dispose);

  return {
    placeholder,
    placeholderIndex,
    isFocused,
    onFocus,
    onBlur,
    dispose,
  };
}
