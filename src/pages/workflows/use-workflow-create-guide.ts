import { ref } from "vue";
import { createWorkflowGuideVisit } from "../../domain/workflow-onboarding";

// Shared across route mounts, reset naturally when the client restarts.
// The legacy durable "seen" preference is intentionally neither read nor changed.
const visit = createWorkflowGuideVisit();

export function useWorkflowCreateGuide() {
  const show = ref(false);
  function enter() { show.value = visit.claim(); }
  function dismiss() { visit.claim(); show.value = false; }
  return { show, enter, dismiss };
}
