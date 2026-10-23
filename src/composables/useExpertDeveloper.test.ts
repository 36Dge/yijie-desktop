// @vitest-environment happy-dom
import { effectScope, ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expertNativeClient } from "../api/expert-native-client";
import type { DeveloperInfo, ExpertSelection } from "../domain/experts.generated";
import { useExpertDeveloper } from "./useExpertDeveloper";
import { expertDisplay, expertTestId } from "../test/expert-fixture";

const scopes: ReturnType<typeof effectScope>[] = [];
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.restoreAllMocks(); });
function render() {
  const expert = ref<ExpertSelection | null>(expertDisplay), context = ref<string | null>(expertTestId(1)), active = ref(true);
  const scope = effectScope(); scopes.push(scope);
  const developer = scope.run(() => useExpertDeveloper(expert, context, active))!;
  return { expert, context, active, developer };
}
describe("expert developer metadata", () => {
  it("reads the name from the native interface with the requested default before it arrives", async () => {
    const read = vi.spyOn(expertNativeClient, "developer").mockResolvedValue({ expert: expertDisplay, name: "示例开发者" });
    const state = render();
    expect(state.developer.value).toBe("易界 AI");
    await flushPromises();
    expect(state.developer.value).toBe("示例开发者");
    expect(read).toHaveBeenCalledWith(expertTestId(1), { expertId: expertDisplay.expertId, version: expertDisplay.version });
  });
  it("keeps the product default with an older native interface", async () => {
    vi.spyOn(expertNativeClient, "developer").mockRejectedValue(new Error("Command unavailable"));
    const state = render(); await flushPromises();
    expect(state.developer.value).toBe("易界 AI");
  });
  it.each(["expert", "context", "inactive", "closed"])("ignores stale metadata after %s changes", async change => {
    let finish!: (result: DeveloperInfo) => void;
    const read = vi.spyOn(expertNativeClient, "developer").mockReturnValueOnce(new Promise(resolve => { finish = resolve; })).mockResolvedValue({ expert: expertDisplay, name: "新开发者" });
    const state = render();
    if (change === "expert") state.expert.value = { ...expertDisplay, version: "0.2.0" };
    else if (change === "context") state.context.value = expertTestId(2);
    else if (change === "inactive") state.active.value = false;
    else state.expert.value = null;
    await flushPromises();
    finish({ expert: expertDisplay, name: "旧开发者" }); await flushPromises();
    expect(state.developer.value).toBe(["expert", "context"].includes(change) ? "新开发者" : "易界 AI");
    expect(read).toHaveBeenCalledTimes(["expert", "context"].includes(change) ? 2 : 1);
  });
});
