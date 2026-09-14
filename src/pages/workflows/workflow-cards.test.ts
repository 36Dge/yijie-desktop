import { describe, expect, it } from "vitest";
import { workflowCards } from "./workflow-cards";
import { MY_WORKFLOWS } from "../../domain/workflow-showcase";

describe("workflow overview projection", () => {
  it("places the newest real resource first and preserves all four examples and card fields", () => {
    const base = { revision: "revision", name: "旧流程", runnable: false, workflow_id: "100", updated_at_ms: 1000 };
    const rows = workflowCards([base, { ...base, workflow_id: "101", name: "新流程", updated_at_ms: 2000 }], MY_WORKFLOWS);
    expect(rows).toHaveLength(6);
    expect(rows[0]?.workflow.title).toBe("新流程");
    expect(rows[0]?.to).toBe("/workflows/101");
    expect(rows[0]?.workflow).toMatchObject({ icon: "workflow", badge: "文本处理", description: expect.any(String), modifiedAt: expect.any(String) });
    expect(rows.slice(2).map(row => row.workflow)).toEqual(MY_WORKFLOWS);
    expect(rows.slice(2).every(row => row.example && row.to === undefined)).toBe(true);
  });
});
