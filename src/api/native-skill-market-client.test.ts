import { describe, expect, it, vi } from "vitest";
import { createNativeSkillMarketClient } from "./native-skill-market-client";
import { nativeCatalogFixture } from "../test/native-skill-fixture";

describe("native Skill marketplace commands", () => {
  it("binds a mutation to the displayed epoch and replays the native receipt", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "skills_list_v2") return nativeCatalogFixture();
      expect(command).toBe("skills_mutate_v2");
      const request = args?.request as { operation_id: string; skill_id: string; expected_epoch: number; kind: string };
      expect(request.expected_epoch).toBe(2); expect(request.kind).toBe("disable");
      return { operation_id: request.operation_id, skill_id: request.skill_id, epoch: 3, state: "complete", error_code: "" };
    });
    const client = createNativeSkillMarketClient(invoke);
    await client.list(); await client.setEnabled("ordinary-skill", false);
    expect(invoke.mock.calls.map(call => call[0])).toEqual(["skills_list_v2", "skills_mutate_v2", "skills_list_v2"]);
  });
  it("keeps all identities when a release grows beyond the old catalog bound", async () => {
    const catalog = nativeCatalogFixture();
    catalog.skills = Array.from({ length: 514 }, (_, i) => ({ ...catalog.skills[0]!, id: `ordinary-${i}` }));
    const result = await createNativeSkillMarketClient(vi.fn(async () => catalog)).list();
    expect(result.skills).toHaveLength(514);
    expect(new Set(result.skills.map(skill => skill.id)).size).toBe(514);
  });
  it("opens the Native picker without passing a renderer file path", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("skills_import_v2");
      expect(Object.keys(args ?? {})).toEqual(["operationId"]);return null;
    });
    expect(await createNativeSkillMarketClient(invoke).importSkill?.()).toBeNull();
  });
  it("confirms the staged file by receipt and reconciles a lost reply with the same operation ID", async () => {
    const selectionId = crypto.randomUUID();
    const dialogId = crypto.randomUUID();
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      switch (command) {
        case "skills_prepare_import_v2":
          expect(args).toEqual({ dialogId, dropId: "native-drop" });
          return { id: selectionId, name: "ordinary.zip" };
        case "skills_confirm_import_v2":
          expect(args).toEqual({ dialogId, selectionId });
          throw { code: "skill_import_outcome_unknown" };
        case "skills_operation_v2":
          expect(args).toEqual({ operationId: selectionId });
          return { operation_id: selectionId, skill_id: "ordinary-skill", epoch: 1, state: "complete", error_code: "" };
        case "skills_list_v2": return nativeCatalogFixture();
        default: throw new Error(command);
      }
    });
    const client = createNativeSkillMarketClient(invoke);
    expect(await client.importDialog?.prepare(dialogId, "native-drop")).toEqual({ id: selectionId, name: "ordinary.zip" });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect((await client.importSkill?.({ dialogId, selectionId }))?.skills).toHaveLength(1);
    expect(invoke.mock.calls.map(call => call[0])).toEqual([
      "skills_prepare_import_v2", "skills_confirm_import_v2", "skills_operation_v2", "skills_list_v2",
    ]);
  });
});
