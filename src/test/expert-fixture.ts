import type { CatalogEntry, CatalogSnapshot, ExpertDisplay } from "../domain/experts-v2.generated";

/** Ordinary synthetic data only; no archives, filesystem or provider calls. */
export const expertTestId = (index: number) => `019c1a00-0000-7000-8000-${index.toString().padStart(12, "0")}`;
export const expertDisplay: ExpertDisplay = { expertId: "sample-expert", version: "0.1.0", displayName: "普通合成专家", subtitle: "本地参考", iconKey: "skillOperations" };
export const expertEntry: CatalogEntry = { display: expertDisplay, description: "用于正常页面验证", platform: "sample", tags: ["运营"], quickPrompts: ["整理当前任务"], knowledgeSummary: "普通合成资料", state: "available" };
export const expertSnapshot = (entry: CatalogEntry = expertEntry): CatalogSnapshot => ({ experts: [entry], canManage: true, executionAvailable: false });
