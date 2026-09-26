import { describe, expect, it } from "vitest";
import { createWorkflowGuideVisit, WORKFLOW_CREATE_GUIDE_KEY } from "./workflow-onboarding";

describe("workflow first-visit preference", () => {
  it("shows once and remembers the visit across a fresh application session", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const visit = createWorkflowGuideVisit(() => storage);
    expect(visit.claim()).toBe(true);
    expect(visit.claim()).toBe(false);
    expect(values).toEqual(new Map([[WORKFLOW_CREATE_GUIDE_KEY, "seen"]]));
    expect(createWorkflowGuideVisit(() => storage).claim()).toBe(false);
  });

  it("does not repeat during navigation when browser storage is unavailable", () => {
    const visit = createWorkflowGuideVisit(() => undefined);
    expect(visit.claim()).toBe(true);
    expect(visit.claim()).toBe(false);
  });

  it("keeps UI navigation usable when storage access is rejected", () => {
    const visit = createWorkflowGuideVisit(() => { throw new Error("Storage unavailable"); });
    expect(visit.claim()).toBe(true);
    expect(visit.claim()).toBe(false);
  });

  it("retains the session fallback if the preference cannot be saved", () => {
    const visit = createWorkflowGuideVisit(() => ({ getItem: () => null, setItem: () => { throw new Error("Storage unavailable"); } }));
    expect(visit.claim()).toBe(true);
    expect(visit.claim()).toBe(false);
  });
});
