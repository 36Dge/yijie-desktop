import type { WorkflowSummary } from "../../api/workflow-native-client";
import type { MyWorkflow } from "../../domain/workflow-showcase";

export interface WorkflowCardView {
  workflow: MyWorkflow;
  to?: string;
  example?: boolean;
}
export function workflowCards(workflows: readonly WorkflowSummary[], examples: readonly MyWorkflow[]): WorkflowCardView[] {
  const date = new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const real: WorkflowCardView[] = [...workflows].sort((a, b) => b.updated_at_ms - a.updated_at_ms || b.workflow_id.localeCompare(a.workflow_id)).map(row => ({
    workflow: {
      id: row.workflow_id, title: row.name, icon: "workflow", accent: "brand", badge: "文本处理",
      description: row.description?.trim() || (row.runnable ? "编排文本处理节点，完成输入到输出的自动化流程" : "从开始、文本处理和结束节点搭建工作流"),
      modifiedAt: date.format(new Date(row.updated_at_ms)),
    },
    to: `/workflows/${encodeURIComponent(row.workflow_id)}`,
  }));
  return [...real, ...examples.map(workflow => ({ workflow, example: true }))];
}
