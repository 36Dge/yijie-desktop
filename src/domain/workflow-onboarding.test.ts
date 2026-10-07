import { describe, expect, it } from "vitest";
import { createWorkflowGuideVisit } from "./workflow-onboarding";

describe("workflow guide per-client visit", () => {
  it("shows once during the current client lifetime", () => {
    const visit = createWorkflowGuideVisit();
    expect(visit.claim()).toBe(true);
    expect(visit.claim()).toBe(false);
    expect(visit.claim()).toBe(false);
  });

  it("a new client starts a fresh visit independently of the previous one", () => {
    const previous = createWorkflowGuideVisit();
    expect(previous.claim()).toBe(true);
    const restarted = createWorkflowGuideVisit();
    expect(restarted.claim()).toBe(true);
    expect(restarted.claim()).toBe(false);
    expect(previous.claim()).toBe(false);
  });
});
