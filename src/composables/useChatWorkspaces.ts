import { computed, onBeforeUnmount, ref, watch } from "vue";
import { chatWorkspaceClient } from "../api/chat-workspace-client";
import { ChatClientError, type ChatProject } from "../domain/chat-ipc";
import { normalizeWorkspaceName, workspaceCreationError, workspaceNameError, type ChatWorkspace, type WorkspaceCatalog, type WorkspaceCreation } from "../domain/chat-workspace";

function requestError(error: unknown, fallback: string): string {
  if (error instanceof ChatClientError) {
    if (error.shape.code === "chat_capability_denied") return "当前账号没有工作空间操作权限。";
    if (error.shape.code === "chat_context_invalid") return "工作空间权限已失效，请刷新后重试。";
  }
  return fallback;
}

export function useChatWorkspaces(options: {
  context: () => string | null;
  enabled: () => boolean;
  projects: () => readonly ChatProject[];
  selected: () => string | null;
  select: (id: string | null) => void;
  create: (name: string) => Promise<WorkspaceCreation | null>;
}) {
  const catalog = ref<WorkspaceCatalog | null>(null);
  const loading = ref(false), creating = ref(false), error = ref(""), createError = ref("");
  const createOpen = ref(false);
  let epoch = 0, readSequence = 0;
  const entries = computed<readonly ChatWorkspace[]>(() => options.projects().map(project =>
    catalog.value?.workspaces.find(entry => entry.project.projectId === project.projectId) ?? { project, path: null },
  ));
  const rootPath = computed(() => catalog.value?.rootPath ?? "~/Yijie/Workspaces");
  async function refresh() {
    const context = options.context(), current = epoch, read = ++readSequence;
    if (!context || !options.enabled()) return;
    loading.value = true; error.value = "";
    try {
      const result = await chatWorkspaceClient.catalog(context);
      if (epoch !== current || read !== readSequence || context !== options.context() || !options.enabled()) return;
      catalog.value = result;
      if (result.workspaces.some(entry => entry.project.projectId === options.selected() && !entry.project.available)) options.select(null);
    } catch (cause) {
      if (epoch === current && read === readSequence) error.value = requestError(cause, "工作空间路径暂不可用，请重试。");
    } finally {
      if (epoch === current && read === readSequence) loading.value = false;
    }
  }
  function setCreateOpen(open: boolean) {
    if (creating.value || (open && (!options.context() || !options.enabled()))) return;
    createOpen.value = open; createError.value = "";
  }
  async function create(rawName: string) {
    const context = options.context(), current = epoch;
    if (!context || !options.enabled() || creating.value) return;
    createError.value = workspaceNameError(rawName);
    if (createError.value) return;
    creating.value = true;
    try {
      const result = await options.create(normalizeWorkspaceName(rawName));
      if (epoch !== current || context !== options.context() || !options.enabled()) return;
      if (!result) { createError.value = "当前无法创建工作空间，请刷新后重试。"; return; }
      if (result.status !== "created") { createError.value = workspaceCreationError(result.status); return; }
      // Invalidate older reads so a catalog request cannot overwrite this new path.
      readSequence++; loading.value = false; error.value = "";
      const workspace = result.workspace;
      catalog.value = { rootPath: workspace.path!.slice(0, workspace.path!.lastIndexOf("/")), workspaces: [workspace, ...(catalog.value?.workspaces ?? []).filter(entry => entry.project.projectId !== workspace.project.projectId)] };
      options.select(workspace.project.projectId);
      createOpen.value = false;
    } catch (cause) {
      if (epoch === current) createError.value = requestError(cause, workspaceCreationError("unavailable"));
    } finally {
      if (epoch === current) creating.value = false;
    }
  }
  watch([options.context, options.enabled], () => {
    epoch++; readSequence++; catalog.value = null; loading.value = false; creating.value = false;
    createOpen.value = false; error.value = ""; createError.value = "";
  });
  onBeforeUnmount(() => { epoch++; });
  return { entries, rootPath, loading, creating, error, createError, createOpen, refresh, setCreateOpen, create };
}
