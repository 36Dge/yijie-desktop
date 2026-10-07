import type { ChatProject } from "./chat-ipc";

export interface ChatWorkspace {
  readonly project: ChatProject;
  readonly path: string | null;
}
export interface WorkspaceCatalog {
  readonly rootPath: string;
  readonly workspaces: readonly ChatWorkspace[];
}
export type WorkspaceCreation =
  | { readonly status: "created"; readonly workspace: ChatWorkspace }
  | { readonly status: "name_conflict" | "invalid_name" | "unavailable"; readonly workspace: null };

export function normalizeWorkspaceName(name: string): string {
  return name.trim().normalize("NFC");
}

export function workspaceNameError(raw: string): string {
  const name = normalizeWorkspaceName(raw);
  if (!name) return "请输入工作空间名称。";
  if ([...name].length > 80 || new TextEncoder().encode(name).length > 240) return "名称最多 80 个字符，请适当缩短。";
  if (name.startsWith(".") || name.endsWith(".") || /[/\\:]/u.test(name) || [...name].some(char => /\p{Cc}/u.test(char))) {
    return "名称不能以点开头或结尾，也不能包含斜杠、冒号或控制字符。";
  }
  return "";
}

export function workspaceCreationError(status: Exclude<WorkspaceCreation["status"], "created">): string {
  if (status === "name_conflict") return "同名文件夹已存在，请换一个名称，或通过“打开本地文件夹”选择已有目录。";
  if (status === "invalid_name") return "名称无法用于创建文件夹，请修改后重试。";
  return "工作空间未创建完成，请重试；如果文件夹已生成，可通过“打开本地文件夹”选择它。";
}
