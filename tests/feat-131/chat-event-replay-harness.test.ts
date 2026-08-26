import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEAT131_FROZEN_REFERENCE,
  FEAT131_REQUIRED_SCENARIO_IDS,
  assessReferenceVersionDrift,
  createChatEventReplayHarness,
  parseChatReplayFixture,
  parseFeat131ScenarioCatalog,
} from "./chat-event-replay-harness";

const FIXTURE_ROOT = new URL("../fixtures/feat-131/", import.meta.url);
const CATALOG_FILE = "scenario-catalog.json";
const REPLAY_FILES = readdirSync(FIXTURE_ROOT)
  .filter((name) => name.endsWith(".synthetic.json"))
  .sort();
const EXPECTED_CAPABILITY_CLASSES = Object.freeze({
  "GS-001": "available",
  "GS-002": "requires Host/Contracts projection",
  "GS-003": "requires Host/Contracts projection",
  "GS-004": "requires Host/Contracts projection",
  "GS-005": "requires Host/Contracts projection",
  "GS-006": "requires Host/Contracts projection",
  "GS-007": "requires Host/Contracts projection",
  "GS-008": "available",
  "GS-009": "available",
  "GS-010": "available",
  "GS-011": "available",
  "GS-012": "requires Host/Contracts projection",
  "GS-013": "requires Host/Contracts projection",
});

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, FIXTURE_ROOT), "utf8"));
}

function withSessionMutation(mutate: (session: Record<string, unknown>) => void): unknown {
  const fixture = structuredClone(readJson("GS-001-streaming-complete.synthetic.json")) as {
    resyncSnapshots: Array<{ session: Record<string, unknown> }>;
  };
  mutate(fixture.resyncSnapshots[0].session);
  return fixture;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("FEAT-131 scenario catalog", () => {
  it("freezes exactly GS-001 through GS-013 and binds only real test assets", () => {
    const catalog = parseFeat131ScenarioCatalog(readJson(CATALOG_FILE));
    expect(catalog.referenceAppVersion).toBe(FEAT131_FROZEN_REFERENCE.version);
    expect(catalog.referenceAppBuild).toBe(FEAT131_FROZEN_REFERENCE.build);
    expect(catalog.scenarios.map((scenario) => scenario.scenarioId).sort())
      .toEqual([...FEAT131_REQUIRED_SCENARIO_IDS].sort());
    expect(Object.fromEntries(catalog.scenarios.map((scenario) => [
      scenario.scenarioId,
      scenario.capabilityClass,
    ]))).toEqual(EXPECTED_CAPABILITY_CLASSES);

    const replayEntries = catalog.scenarios.filter((scenario) => scenario.assetKind === "replay");
    expect(replayEntries.map((scenario) => scenario.replayFixture).sort()).toEqual(REPLAY_FILES);
    for (const entry of replayEntries) {
      if (entry.replayFixture === null) throw new Error("replay fixture missing after catalog parse");
      expect(entry.replayFixture).toMatch(/\.synthetic\.json$/);
      expect(entry.provenance).toBe("synthetic");
      const fixture = parseChatReplayFixture(readJson(entry.replayFixture));
      expect(fixture.scenarioId).toBe(entry.scenarioId);
      expect(fixture.provenance).toBe("synthetic");
      expect(fixture.coveredVariants).toEqual(entry.replayedVariants);
      expect(fixture.referenceAppVersion).toBe(catalog.referenceAppVersion);
      expect(fixture.referenceAppBuild).toBe(catalog.referenceAppBuild);
    }

    const metadataOnly = catalog.scenarios.filter((scenario) => scenario.assetKind === "metadata-only");
    expect(metadataOnly.every((scenario) =>
      scenario.replayedVariants.length === 0 &&
      scenario.provenance === null &&
      scenario.replayFixture === null)).toBe(true);
    expect(catalog.scenarios.find((scenario) => scenario.scenarioId === "GS-003")?.variants)
      .toEqual(["success", "failure"]);
    expect(catalog.scenarios.find((scenario) => scenario.scenarioId === "GS-004")?.variants)
      .toEqual(["success", "failure"]);
    expect(catalog.scenarios.find((scenario) => scenario.scenarioId === "GS-005")?.variants)
      .toEqual(["allow", "deny", "expired"]);
    expect(catalog.scenarios.find((scenario) => scenario.scenarioId === "GS-013")?.replayedVariants)
      .toEqual(["missing-delta"]);
  });

  it.each([
    ["unix absolute path", "/etc/example"],
    ["windows absolute path", "C:\\Users\\fixture\\example.txt"],
    ["windows UNC path", "\\\\server\\share\\fixture.txt"],
    ["windows device path", "\\\\?\\C:\\fixture\\example.txt"],
    ["URL-like value", "https://example.invalid/fixture"],
    ["email-like value", "fixture@example.invalid"],
    ["phone-like value", "+8613800000000"],
    ["formatted phone value", "138-0000-0000"],
    ["bearer-like value", "Bearer synthetic-canary"],
    ["secret-like value", "secret"],
    ["API-key-like value", "api key"],
    ["access-token-like value", "access token"],
    ["client-secret-like value", "client secret"],
    ["credential-like value", "credential"],
    ["private-key-like value", "private key"],
    ["JWT-like value", [
      "eyJhbGciOiJIUzI1NiJ9",
      "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "signature",
    ].join(".")],
    ["AWS-access-key-like value", `AKIA${"0".repeat(16)}`],
    ["GitHub-token-like value", `ghp_${"x".repeat(24)}`],
    ["shop value", "shop canary"],
    ["order value", "order canary"],
    ["buyer value", "buyer canary"],
    ["seller value", "seller canary"],
    ["Chinese commerce value", "合成店铺数据"],
  ])("rejects the %s inside an otherwise valid fixture", (_label, value) => {
    expect(() => parseChatReplayFixture(withSessionMutation((session) => {
      session.title = value;
    }))).toThrow("feat131-replay-sensitive");
  });

  it.each([
    "apiKey",
    "access_token",
    "authorization",
    "absolute_path",
    "systemPrompt",
    "cookie",
    "merchantId",
    "buyerId",
    "sellerId",
    "prompt",
    "path",
  ])("rejects the %s key inside an otherwise valid fixture", (key) => {
    expect(() => parseChatReplayFixture(withSessionMutation((session) => {
      session[key] = "synthetic-canary";
    }))).toThrow("feat131-replay-sensitive");
  });

  it("reports an installed-version drift without changing the frozen baseline", () => {
    const catalogValue = readJson(CATALOG_FILE);
    const before = JSON.stringify(catalogValue);
    expect(assessReferenceVersionDrift("26.900.0", "8000")).toEqual({
      status: "drift",
      frozenVersion: "26.818.61809",
      frozenBuild: "7019",
      observedVersion: "26.900.0",
      observedBuild: "8000",
      baselineAction: "report-only",
    });
    expect(JSON.stringify(catalogValue)).toBe(before);

    const changedCatalog = {
      ...(catalogValue as Record<string, unknown>),
      referenceAppBuild: "8000",
    };
    expect(() => parseFeat131ScenarioCatalog(changedCatalog))
      .toThrow("feat131-catalog-invalid:frozen-reference");
  });
});

describe.each(REPLAY_FILES)("FEAT-131 raw event replay: %s", (fixtureName) => {
  it("passes raw payloads through the production parser and store deterministically", async () => {
    vi.useFakeTimers();
    const fixtureValue = readJson(fixtureName);
    const fixture = parseChatReplayFixture(fixtureValue);
    vi.setSystemTime(fixture.fixedNowEpochMs);
    const harness = await createChatEventReplayHarness(fixtureValue);

    try {
      for (const step of harness.fixture.steps) {
        expect(harness.emit(step)).toEqual(step.expect);
      }
      await harness.settle();
      expect(harness.snapshot()).toEqual(harness.fixture.expectedAfterSettle);
      harness.assertConsumed();
      expect(harness.callCount("chat_subscribe_session_v1"))
        .toBe(harness.fixture.ids.subscriptionIds.length);
      expect(harness.callCount("chat_resync_session_v2"))
        .toBe(harness.fixture.resyncSnapshots.length);
    } finally {
      await harness.dispose();
      expect(harness.listenerCount()).toBe(0);
    }
  });
});
