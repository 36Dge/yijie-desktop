import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatModelBuildCandidateSelection, verifyChatModelBuildCandidate } from "./chat-model-build-candidate.mjs";

const model = { YIJIE_ENV: "local", YIJIE_LOCAL_PROFILE: "demo_fast", YIJIE_CHAT_MODELS_ENABLED: "true" };
const expert = { ...model, YIJIE_EXPERTS_ENABLED: "true", YIJIE_MARKET_CONNECTORS_ENABLED: "true", YIJIE_RUNTIME_PERMISSIONS_ENABLED: "true" };

it("retains the original model pin for ordinary local builds", () => {
  const expected = { feature: "FEAT-156", file: "chat-model-host-build.candidate.json" };
  expect(chatModelBuildCandidateSelection(model)).toEqual(expected);
  expect(chatModelBuildCandidateSelection({ ...model, YIJIE_EXPERTS_ENABLED: "false" })).toEqual(expected);
});

it("selects the separate expert snapshot only with all existing local prerequisites", () => {
  expect(chatModelBuildCandidateSelection(expert)).toEqual({ feature: "FEAT-158", file: "experts-host-build.candidate.json" });
  for (const name of ["YIJIE_ENV", "YIJIE_LOCAL_PROFILE", "YIJIE_CHAT_MODELS_ENABLED", "YIJIE_MARKET_CONNECTORS_ENABLED", "YIJIE_RUNTIME_PERMISSIONS_ENABLED"]) {
    expect(() => chatModelBuildCandidateSelection({ ...expert, [name]: "" })).toThrow();
  }
});

it.skipIf(process.env.YIJIE_EXPERT_CANDIDATE_CHECK !== "true")("checks the actual reviewed expert source and resources without rewriting the model pin", () => {
  const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const modelPin = path.join(desktop, "contracts/chat-model-host-build.candidate.json");
  const previous = readFileSync(modelPin);
  const sources = verifyChatModelBuildCandidate(desktop, path.resolve(desktop, "../yijie-contracts"), path.resolve(desktop, "../yijie-agent-host"), expert);
  expect(sources["internal/session/expert_resources.go"]).toMatch(/^[a-f0-9]{64}$/);
  expect(sources["api/experts.candidate.json"]).toMatch(/^[a-f0-9]{64}$/);
  expect(readFileSync(modelPin).equals(previous)).toBe(true);
}, 120_000);
