import { onScopeDispose, shallowRef, watch, type ComputedRef } from "vue";
import type { summarizeActivity } from "../../domain/conversation-activity-summary";

type Summary = ReturnType<typeof summarizeActivity>;

/** Stabilize changes of activity identity, never text within that identity.
 * Completion and a different group take effect immediately. Facts are not delayed. */
export function useActivitySummary(summary: ComputedRef<Summary>, groupIdentity: () => string) {
  const displayed = shallowRef(summary.value);
  let changedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } };
  watch([groupIdentity, summary], ([identity, next], [previousIdentity]) => {
    clear();
    const commit = () => { displayed.value = next; changedAt = Date.now(); timer = undefined; };
    if (identity !== previousIdentity || next.state === "summary") { commit(); return; }
    if (next.key === displayed.value.key) { displayed.value = next; return; }
    const remaining = 1_000 - (Date.now() - changedAt);
    if (remaining <= 0) commit();
    else timer = setTimeout(commit, remaining);
  }, {flush: "sync"});
  onScopeDispose(clear);
  return displayed;
}
