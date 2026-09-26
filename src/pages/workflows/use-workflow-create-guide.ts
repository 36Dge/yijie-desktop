import { ref } from "vue";
import { createWorkflowGuideVisit } from "../../domain/workflow-onboarding";

const visit = createWorkflowGuideVisit(() => window.localStorage);

export function useWorkflowCreateGuide() {
  const show = ref(false);
  function enter() { show.value = visit.claim(); }
  function dismiss() { visit.claim(); show.value = false; }
  return { show, enter, dismiss };
}
