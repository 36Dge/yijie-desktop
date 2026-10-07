/** One visit per running client. A new WebView runtime starts a fresh visit. */
export function createWorkflowGuideVisit() {
  let visited = false;
  return {
    claim(): boolean {
      if (visited) return false;
      visited = true;
      return true;
    },
  };
}
