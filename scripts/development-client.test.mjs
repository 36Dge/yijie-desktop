import { describe, expect, it } from "vitest";
import { developmentArguments } from "./run-workflow-dev.mjs";

const current = {
  YIJIE_DEVELOPMENT_CLIENT: "true", YIJIE_FEAT164_DAILY: "true", YIJIE_KIMI_K31_PRO_CANDIDATE: "true",
  YIJIE_KIMI_K31_CALL_SURFACES: "media", YIJIE_EXPERTS_ENABLED: "true", YIJIE_MARKET_CONNECTORS_ENABLED: "true",
  YIJIE_ARTIFACT_MEDIA_ENABLED: "true", YIJIE_FEAT155_SCHEDULED_DAILY: "true", YIJIE_FEAT155_SCHEDULED_CANDIDATE: "false",
};

describe("fixed development launch selection", () => {
  it("keeps all current resources in a no-watch dev launch without a package action", () => {
    const args = developmentArguments(current);
    expect(args.slice(0, 3)).toEqual(["exec", "tauri", "dev"]);
    expect(args).toContain("--no-watch");
    expect(args).toContain("kimi-k31-pro-candidate");
    expect(args).toContain("src-tauri/tauri.workflow-local.conf.json");
    expect(args).toContain("src-tauri/tauri.demo-fast.conf.json");
    expect(args).toContain("src-tauri/tauri.feat164-experts.conf.json");
    expect(args).not.toContain("build");
    expect(args).not.toContain("--bundles");
  });
  it.each(["YIJIE_ARTIFACT_MEDIA_ENABLED", "YIJIE_EXPERTS_ENABLED", "YIJIE_MARKET_CONNECTORS_ENABLED"])("does not silently omit %s", flag => {
    expect(() => developmentArguments({...current, [flag]: "false"})).toThrow("complete current daily profile");
  });
  it("retains the historical workflow development profile", () => {
    expect(developmentArguments({YIJIE_EXPERTS_ENABLED: "true"})).toContain("src-tauri/tauri.experts-daily.conf.json");
    expect(developmentArguments({})).not.toContain("kimi-k31-pro-candidate");
  });
});
