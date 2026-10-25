import { ref, watch, type Ref } from "vue";
import { expertNativeClient } from "../api/expert-native-client";
import type { ExpertSelection } from "../domain/experts-v2.generated";

import { defaultExpertDeveloper } from "../domain/expert-ui";

/** Older native clients may not expose metadata yet; use the product default. */
export function useExpertDeveloper(expert: Ref<ExpertSelection | null>, contextId: Ref<string | null>, active: Ref<boolean>) {
  const developer = ref(defaultExpertDeveloper);
  watch(() => [expert.value?.expertId, expert.value?.version, contextId.value, active.value] as const, async ([expertId, version, context, enabled], _, onCleanup) => {
    let current = true;
    onCleanup(() => { current = false; });
    developer.value = defaultExpertDeveloper;
    if (!enabled || !expertId || !version || !context) return;
    try {
      const result = await expertNativeClient.developer(context, { expertId, version });
      if (current) developer.value = result.name.trim() || defaultExpertDeveloper;
    } catch {
      // Metadata failure must not block catalog browsing or change execution access.
    }
  }, { immediate: true });
  return developer;
}
