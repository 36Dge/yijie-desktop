export const WORKFLOW_CREATE_GUIDE_KEY = "yijie.desktop.ui.workflow-create-guide.v1";

interface GuideStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** A best-effort, device-local UI preference; no account or workflow data. */
export function createWorkflowGuideVisit(getStorage: () => GuideStorage | undefined) {
  let visited = false;
  return {
    claim(): boolean {
      if (visited) return false;
      visited = true;
      try {
        const storage = getStorage();
        if (storage?.getItem(WORKFLOW_CREATE_GUIDE_KEY) === "seen") return false;
        storage?.setItem(WORKFLOW_CREATE_GUIDE_KEY, "seen");
      } catch {
        // Keep the once-per-session fallback when browser storage is unavailable.
      }
      return true;
    },
  };
}
