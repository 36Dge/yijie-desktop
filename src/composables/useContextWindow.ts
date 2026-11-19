import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { readContextWindow, type ContextWindowSnapshot } from "../api/context-window-client";

/** Polls only the selected session's read-only native observation. Never a model request. */
export function useContextWindow(
  context: () => string | null,
  session: () => string | null,
  model: () => string | null,
  revision: () => number | null,
  switching: () => boolean,
) {
  const snapshot = shallowRef<ContextWindowSnapshot | null>(null);
  const compactionSnapshot = shallowRef<ContextWindowSnapshot | null>(null);
  let epoch = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let includeHistory = true;
  const observation = computed(() => {
    const value = snapshot.value;
    if (!value?.thread_id) return null;
    if (value.sample && value.model_profile) {
      const current = !switching() && value.model_profile === model() && value.model_revision === revision();
      return { sample: value.sample, lastModel: current ? null : value.model_profile };
    }
    const last = value.last_observation;
    return last ? { sample: last.sample, lastModel: last.model } : null;
  });

  async function refresh(generation: number) {
    const c = context(), s = session();
    if (disposed || generation !== epoch || !c || !s) return;
    try {
      const result = await readContextWindow(c, s, includeHistory, true);
      if (disposed || generation !== epoch) return;
      includeHistory = false;
      snapshot.value = result;
      if (compactionSnapshot.value?.thread_id !== result.thread_id || JSON.stringify(compactionSnapshot.value?.compactions) !== JSON.stringify(result.compactions)) {
        compactionSnapshot.value = result;
      }
    } catch {
      if (generation === epoch) {
        snapshot.value = null;
        if (compactionSnapshot.value) compactionSnapshot.value = {
          ...compactionSnapshot.value,
          compactions: compactionSnapshot.value.compactions.map(item => item.state === "in_progress" ? { ...item, state: "unknown" } : item),
        };
      }
    } finally {
      if (!disposed && generation === epoch) timer = setTimeout(() => { void refresh(generation); }, 1000);
    }
  }
  // Model selection changes attribution, not ownership of the conversation read.
  watch([context, session], () => {
    const generation = ++epoch;
    clearTimeout(timer);
    snapshot.value = null;
    includeHistory = true;
    compactionSnapshot.value = null;
    void refresh(generation);
  }, { immediate: true, flush: "sync" });
  onBeforeUnmount(() => { disposed = true; epoch++; clearTimeout(timer); });
  return { sample: computed(() => observation.value?.sample ?? null), lastModel: computed(() => observation.value?.lastModel ?? null), snapshot, compactionSnapshot };
}
