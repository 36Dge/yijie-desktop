import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { MutationKind, Operation, PendingOperation } from "../domain/skill-market-v2.generated";
import { parseNativeSkillCatalog, parseNativeSkillOperation } from "../domain/native-skill-marketplace";
import type { SkillCatalogSnapshot } from "../domain/skill-marketplace";
import type { SkillNativeClient, SkillNativeInvoker } from "./skill-native-client";
import { SkillNativeClientError } from "./skill-native-client";

export function createNativeSkillMarketClient(nativeInvoke: SkillNativeInvoker = invoke): SkillNativeClient {
  let latest: SkillCatalogSnapshot | undefined;
  const listeners = new Set<(operation: PendingOperation) => void>();
  function announce(op: Operation): void { for (const listener of listeners) listener(op); }
  async function request(command: string, args?: Record<string, unknown>): Promise<unknown> {
    try { return await nativeInvoke(command, args); }
    catch (error: unknown) {
      if (error instanceof SkillNativeClientError) throw error;
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "skill_host_unavailable";
      throw new SkillNativeClientError(code === "unauthorized" ? "unauthorized" : code === "capability_denied" ? "permission-denied" : code === "skill_contract_mismatch" ? "incompatible" : "operation-failed", code);
    }
  }
  async function list(signal?: AbortSignal): Promise<SkillCatalogSnapshot> {
    if (signal?.aborted) throw new SkillNativeClientError("aborted");
    let raw: unknown;
    const deadline = Date.now() + 15_000;
    for (;;) {
      try { raw = await request("skills_list_v2"); break; }
      catch (error) {
        if (!(error instanceof SkillNativeClientError) || error.code !== "skill_migration_pending" || Date.now() >= deadline || signal?.aborted) throw error;
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }
    const result = parseNativeSkillCatalog(raw);
    if (signal?.aborted) throw new SkillNativeClientError("aborted");
    latest = result; return result;
  }
  async function finish(initial: Operation): Promise<SkillCatalogSnapshot> {
    let operation = initial;
    const deadline = Date.now() + 60_000;
    for (;;) {
      announce(operation);
      if (operation.state === "complete" || operation.state === "cancelled") return list();
      if (operation.state === "needs_attention") throw new SkillNativeClientError("operation-failed", operation.error_code);
      if (Date.now() > deadline) throw new SkillNativeClientError("operation-failed", "reconciliation_pending");
      await new Promise(resolve => setTimeout(resolve, 400));
      operation = parseNativeSkillOperation(await request("skills_operation_v2", { operationId: operation.operation_id }));
    }
  }
  async function mutate(id: string, kind: MutationKind): Promise<SkillCatalogSnapshot> {
    if (!latest) await list();
    const skill = latest?.skills.find(skill => skill.id === id);
    if (skill?.nativeEpoch === undefined) throw new SkillNativeClientError("conflict");
    const operation = parseNativeSkillOperation(await request("skills_mutate_v2", { request: { operation_id: crypto.randomUUID(), skill_id: id, kind, expected_epoch: skill.nativeEpoch } }));
    return finish(operation);
  }
  return {
    list, scan: (_reason, signal) => list(signal), install: id => mutate(id, "install"),
    setEnabled: (id, enabled) => mutate(id, enabled ? "enable" : "disable"), uninstall: id => mutate(id, "uninstall"),
    async importSkill() {
      const id = crypto.randomUUID();
      try {
        const result = await request("skills_import_v2", { operationId: id });
        if (result === null) return null;
        return finish(parseNativeSkillOperation(result));
      } catch (error) {
        // A lost import response is reconciled by the same identity, not a
        // second upload. The Host catalog also restores pending work on reopen.
        if (error instanceof SkillNativeClientError && error.code === "skill_import_outcome_unknown") {
          return finish(parseNativeSkillOperation(await request("skills_operation_v2", { operationId: id })));
        }
        throw error;
      }
    },
    async cancelOperation(id) { return finish(parseNativeSkillOperation(await request("skills_cancel_v2", { operationId: id }))); },
    subscribeOperations(handler) { listeners.add(handler); return () => listeners.delete(handler); },
    subscribeDirectoryChanged(handler) { return listen("skills-directory-changed-v1", handler); },
  };
}
