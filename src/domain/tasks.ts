export type TaskStatus = "draft" | "running" | "waiting_approval" | "completed" | "failed";

export interface AgentTask {
  id: string;
  title: string;
  status: TaskStatus;
  description: string;
}

export const sampleTasks: AgentTask[] = [
  {
    id: "local-task-001",
    title: "Amazon Listing 诊断",
    status: "draft",
    description: "桌面端输入商品链接后创建的 MVP 任务占位。",
  },
  {
    id: "local-task-002",
    title: "工具调用审批",
    status: "waiting_approval",
    description: "高风险写操作必须通过审批卡片后再交给连接器执行。",
  },
];
