import { computed, onScopeDispose, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import {
  skillNativeClient,
  SkillNativeClientError,
  type SkillNativeClient,
  type SkillNativeFailureKind,
  type SkillScanReason,
} from "../api/skill-native-client";
import {
  projectSkillCategories,
  skillCanInstall,
  type ManagedSkillProjection,
  type SkillCatalogSnapshot,
} from "../domain/skill-marketplace";

const STORE_ID = "skills";
const EMPTY_SKILLS: readonly ManagedSkillProjection[] = Object.freeze([]);

export type SkillStorePhase =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "permission-denied"
  | "unavailable"
  | "incompatible";
export type SkillOperationKind = "install" | "enable" | "disable" | "uninstall";

function failureKind(error: unknown): SkillNativeFailureKind {
  return error instanceof SkillNativeClientError ? error.kind : "unavailable";
}

export function skillNativeFailureMessage(kind: SkillNativeFailureKind): string {
  switch (kind) {
    case "aborted":
      return "本次读取已取消。";
    case "unauthorized":
      return "本机服务凭据未就绪，请重新打开应用后重试。";
    case "permission-denied":
      return "当前本地身份没有插件管理权限。";
    case "not-found":
      return "此 Skill 已不在当前客户端清单中，请重新扫描。";
    case "not-installable":
      return "此 Skill 尚未通过安装审核。";
    case "conflict":
      return "Skill 状态已变化，请重新扫描后再试。";
    case "busy":
      return "此 Skill 正在执行其他操作，请稍后重试。";
    case "bundle-invalid":
      return "内置 Skill 资源未通过完整性或路径安全校验。";
    case "operation-failed":
      return "本地 Skill 操作未完成，原有可用状态已保留。";
    case "unavailable":
      return "本地 Skill 服务暂不可用，请确认服务已启动后重试。";
    case "incompatible":
      return "Skill 响应与当前客户端不兼容，请升级客户端。";
  }
}

export function createSkillStoreDefinition(
  client: SkillNativeClient,
  storeId = STORE_ID,
) {
  return defineStore(storeId, () => {
    const phase = ref<SkillStorePhase>("idle");
    const skills = shallowRef<readonly ManagedSkillProjection[]>(EMPTY_SKILLS);
    const scannedAt = ref<string | null>(null);
    const lastFailure = ref<SkillNativeFailureKind | null>(null);
    const refreshing = ref(false);
    const operations = shallowRef<Readonly<Record<string, SkillOperationKind>>>(Object.freeze({}));
    const operationErrors = shallowRef<Readonly<Record<string, string>>>(Object.freeze({}));
    const categories = computed(() => projectSkillCategories(skills.value));

    let readEpoch = 0;
    let activeRead: AbortController | null = null;
    let reconcileReason: SkillScanReason | null = null;
    let disposed = false;

    function applySnapshot(
      snapshot: SkillCatalogSnapshot,
      completedSkillId: string | null = null,
    ): void {
      skills.value = snapshot.skills;
      scannedAt.value = snapshot.scannedAt;
      phase.value = snapshot.skills.length === 0 ? "empty" : "ready";
      lastFailure.value = null;
      const nextErrors = Object.fromEntries(
        Object.entries(operationErrors.value).filter(([skillId]) => {
          if (skillId === completedSkillId) return false;
          const skill = snapshot.skills.find((entry) => entry.id === skillId);
          return skill !== undefined && skillCanInstall(skill);
        }),
      );
      operationErrors.value = Object.freeze(nextErrors);
    }

    function setOperation(skillId: string, operation: SkillOperationKind | null): void {
      const next = { ...operations.value };
      if (operation === null) delete next[skillId];
      else next[skillId] = operation;
      operations.value = Object.freeze(next);
    }

    function setOperationError(skillId: string, message: string | null): void {
      const next = { ...operationErrors.value };
      if (message === null) delete next[skillId];
      else next[skillId] = message;
      operationErrors.value = Object.freeze(next);
    }

    function applyReadFailure(error: unknown, hadProjection: boolean): void {
      const kind = failureKind(error);
      if (kind === "aborted") return;
      lastFailure.value = kind;
      if (kind === "unauthorized" || kind === "permission-denied") {
        skills.value = EMPTY_SKILLS;
        scannedAt.value = null;
        phase.value = "permission-denied";
      } else if (kind === "incompatible") {
        skills.value = EMPTY_SKILLS;
        scannedAt.value = null;
        phase.value = "incompatible";
      } else if (!hadProjection) {
        phase.value = "unavailable";
      }
    }

    async function readSnapshot(
      canManage: boolean,
      reason: SkillScanReason,
      showInitialLoading: boolean,
    ): Promise<void> {
      if (disposed) return;
      if (Object.keys(operations.value).length > 0) {
        reconcileReason = reason;
        return;
      }
      activeRead?.abort();
      const controller = new AbortController();
      activeRead = controller;
      readEpoch += 1;
      const epoch = readEpoch;
      const hadProjection = phase.value === "ready" || phase.value === "empty";
      if (showInitialLoading && !hadProjection) phase.value = "loading";
      refreshing.value = hadProjection;
      lastFailure.value = null;
      try {
        let snapshot: SkillCatalogSnapshot;
        try {
          snapshot = canManage
            ? await client.scan(reason, controller.signal)
            : await client.list(controller.signal);
        } catch (error: unknown) {
          // A busy scan does not mean the catalog service is unavailable.
          // Read its live projection, including when talking to an older Host
          // with a full scan journal. Auth/compatibility failures never fall back.
          if (!canManage || failureKind(error) !== "busy" || controller.signal.aborted) throw error;
          snapshot = await client.list(controller.signal);
        }
        if (disposed || activeRead !== controller || epoch !== readEpoch || controller.signal.aborted) {
          return;
        }
        applySnapshot(snapshot);
      } catch (error: unknown) {
        if (activeRead !== controller || epoch !== readEpoch) return;
        applyReadFailure(error, hadProjection);
      } finally {
        if (activeRead === controller) activeRead = null;
        if (epoch === readEpoch) refreshing.value = false;
      }
    }

    async function open(canManage: boolean): Promise<void> {
      await readSnapshot(canManage, "page_open", true);
    }

    async function refresh(
      canManage: boolean,
      reason: SkillScanReason = "user_retry",
    ): Promise<void> {
      await readSnapshot(canManage, reason, false);
    }

    async function perform(
      skillId: string,
      operation: SkillOperationKind,
      mutation: () => Promise<SkillCatalogSnapshot>,
    ): Promise<boolean> {
      if (disposed || operations.value[skillId] !== undefined) return false;
      if (!skills.value.some((skill) => skill.id === skillId)) {
        setOperationError(skillId, "此 Skill 已不在当前客户端清单中，请重新扫描。");
        return false;
      }
      activeRead?.abort();
      activeRead = null;
      readEpoch += 1;
      refreshing.value = false;
      setOperation(skillId, operation);
      setOperationError(skillId, null);
      let succeeded = false;
      try {
        applySnapshot(await mutation(), skillId);
        succeeded = true;
      } catch (error: unknown) {
        const kind = failureKind(error);
        setOperationError(skillId, skillNativeFailureMessage(kind));
        if (kind === "unauthorized" || kind === "permission-denied") {
          lastFailure.value = kind;
        }
      } finally {
        setOperation(skillId, null);
        if (Object.keys(operations.value).length === 0 && reconcileReason !== null) {
          const reason = reconcileReason;
          reconcileReason = null;
          await readSnapshot(true, reason, false);
        }
      }
      return succeeded;
    }

    function install(skillId: string): Promise<boolean> {
      return perform(skillId, "install", () => client.install(skillId));
    }

    function setEnabled(skillId: string, enabled: boolean): Promise<boolean> {
      return perform(skillId, enabled ? "enable" : "disable", () =>
        client.setEnabled(skillId, enabled),
      );
    }

    function uninstall(skillId: string): Promise<boolean> {
      return perform(skillId, "uninstall", () => client.uninstall(skillId));
    }

    function clearOperationError(skillId: string): void {
      setOperationError(skillId, null);
    }

    function dispose(): void {
      disposed = true;
      readEpoch += 1;
      activeRead?.abort();
      activeRead = null;
      reconcileReason = null;
      refreshing.value = false;
    }

    onScopeDispose(dispose);

    return {
      phase,
      skills,
      scannedAt,
      lastFailure,
      refreshing,
      operations,
      operationErrors,
      categories,
      open,
      refresh,
      install,
      setEnabled,
      uninstall,
      clearOperationError,
      dispose,
    };
  });
}

export const useSkillStore = createSkillStoreDefinition(skillNativeClient);
