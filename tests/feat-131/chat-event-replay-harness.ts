import { createPinia } from "pinia";
import {
  createChatClient,
  type ChatClientTransport,
} from "../../src/api/chat-client";
import {
  CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL,
  CHAT_CONTROL_PLANE_EVENT_CHANNEL,
  CHAT_EVENT_CHANNEL,
} from "../../src/domain/chat-ipc";
import {
  createChatStoreDefinition,
  type ChatViewPhase,
} from "../../src/stores/chat.store";

export const FEAT131_REPLAY_FIXTURE_FAMILY = "feat131-desktop-replay-v2" as const;
export const FEAT131_REPLAY_HARNESS_CANARY = "feat131-replay-harness-test-only" as const;
export const FEAT131_REFERENCE_POLICY = Object.freeze({
  id: "codex-inspired-approximate-parity-v1-2026-08-27",
  mode: "owner-approved-inference",
});
export const FEAT131_REQUIRED_SCENARIO_IDS = Object.freeze(
  Array.from({ length: 13 }, (_, index) => `GS-${String(index + 1).padStart(3, "0")}`),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SCENARIO_ID_PATTERN = /^GS-[0-9]{3}$/;
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;
const ABSOLUTE_PATH_PATTERN = /(?:^|[^A-Za-z0-9+.-])\/(?!\/)[^\s]*/;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(?:^|[\s"'(])[A-Za-z]:\\/;
const WINDOWS_UNC_PATH_PATTERN = /(?:^|[\s"'(])\\\\[^\\\s]+\\[^\\\s]+/;
const URL_PATTERN = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:^|[^0-9])(?:\+?[1-9][0-9]{7,14}|1[3-9][0-9]{9})(?:$|[^0-9])/;
const FORMATTED_PHONE_PATTERN = /(?:\+?86[\s-]?)?1[3-9][0-9](?:[\s-]?[0-9]){8}|(?:\+?1[\s.-]?)?\([2-9][0-9]{2}\)[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}/;
const SECRET_PATTERN = /\b(?:bearer(?:\s+[A-Za-z0-9._-]+)?|secret|sk-[A-Za-z0-9]+|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|credential|password|private key)\b/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/;
const OPAQUE_CREDENTIAL_PATTERN = /\b(?:A(?:KI|SI)A[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;
const COMMERCE_VALUE_PATTERN = /(?:\b(?:merchant|shop|store|order|buyer|seller)\b|商家|店铺|订单|买家|卖家)/i;
const COMMERCE_KEY_PATTERN = /(?:merchant|shop|store|order|buyer|seller)/i;
const SENSITIVE_KEY_PATTERN = /(?:absolutepath|filepath|path|email|phone|cookie|password|prompt|secret|token|authorization|credential|privatekey|apikey)/i;
const FORBIDDEN_KEYS = new Set([
  "absolutePath",
  "buyer",
  "cookie",
  "email",
  "merchant",
  "password",
  "path",
  "phone",
  "prompt",
  "secret",
  "seller",
  "token",
]);
const VIEW_PHASES = new Set<ChatViewPhase>([
  "idle",
  "binding",
  "loading",
  "ready",
  "streaming",
  "resyncing",
  "resync-required",
  "permission-denied",
  "signed-out",
  "unavailable",
]);
const CAPABILITY_CLASSES = new Set([
  "available",
  "requires Host/Contracts projection",
  "blocked by frozen Runtime",
  "intentional product difference",
]);

type JsonRecord = Record<string, unknown>;

export type ReplayProvenance = "real-runtime" | "synthetic";
export type ReplayReferenceBasis = "owner-approved-inference" | "owner-excluded";

export interface ChatReplaySnapshot {
  readonly phase: ChatViewPhase;
  readonly selectedSessionId: string | null;
  readonly liveAssistantText: string;
  readonly liveReasoningTexts: readonly string[];
  readonly liveTurnStatus: string | null;
  readonly historyAssistantText: string | null;
  readonly historyTurnStatus: string | null;
  readonly lastErrorCode: string | null;
  readonly controlPlaneState: string | null;
}

export interface ChatReplayStep {
  readonly event: JsonRecord;
  readonly expect: ChatReplaySnapshot;
}

export interface ChatReplayFixture {
  readonly fixtureSchemaVersion: 2;
  readonly fixtureFamily: typeof FEAT131_REPLAY_FIXTURE_FAMILY;
  readonly referencePolicyId: typeof FEAT131_REFERENCE_POLICY.id;
  readonly referencePolicyMode: typeof FEAT131_REFERENCE_POLICY.mode;
  readonly scenarioId: string;
  readonly provenance: ReplayProvenance;
  readonly coveredVariants: readonly string[];
  readonly fixedNowEpochMs: number;
  readonly tenantSelector: string;
  readonly ids: Readonly<{
    contextId: string;
    projectId: string;
    sessionId: string;
    turnId: string;
    subscriptionIds: readonly string[];
  }>;
  readonly resyncSnapshots: readonly JsonRecord[];
  readonly steps: readonly ChatReplayStep[];
  readonly expectedAfterSettle: ChatReplaySnapshot;
}

export interface Feat131ScenarioCatalogEntry {
  readonly scenarioId: string;
  readonly title: string;
  readonly variants: readonly string[];
  readonly ownerFeature: string;
  readonly capabilityClass: string;
  readonly assetKind: "replay" | "metadata-only";
  readonly replayedVariants: readonly string[];
  readonly provenance: ReplayProvenance | null;
  readonly referenceBasis: ReplayReferenceBasis;
  readonly replayFixture: string | null;
}

export interface Feat131ScenarioCatalog {
  readonly catalogSchemaVersion: 2;
  readonly fixtureFamily: typeof FEAT131_REPLAY_FIXTURE_FAMILY;
  readonly referencePolicyId: typeof FEAT131_REFERENCE_POLICY.id;
  readonly referencePolicyMode: typeof FEAT131_REFERENCE_POLICY.mode;
  readonly policyEffectiveAt: string;
  readonly scenarios: readonly Feat131ScenarioCatalogEntry[];
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`feat131-replay-invalid:${label}`);
  }
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`feat131-replay-invalid:${label}`);
  }
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    value.length > 4096 ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new Error(`feat131-replay-invalid:${label}`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label, true);
}

function uuid(value: unknown, label: string): string {
  const parsed = stringValue(value, label);
  if (!UUID_PATTERN.test(parsed) || parsed === "00000000-0000-0000-0000-000000000000") {
    throw new Error(`feat131-replay-invalid:${label}`);
  }
  return parsed;
}

function assertSafeFixtureValue(value: unknown, key = "root"): void {
  if (typeof value === "string") {
    if (
      ABSOLUTE_PATH_PATTERN.test(value) ||
      WINDOWS_ABSOLUTE_PATH_PATTERN.test(value) ||
      WINDOWS_UNC_PATH_PATTERN.test(value) ||
      URL_PATTERN.test(value) ||
      EMAIL_PATTERN.test(value) ||
      PHONE_PATTERN.test(value) ||
      FORMATTED_PHONE_PATTERN.test(value) ||
      SECRET_PATTERN.test(value) ||
      JWT_PATTERN.test(value) ||
      OPAQUE_CREDENTIAL_PATTERN.test(value) ||
      COMMERCE_VALUE_PATTERN.test(value)
    ) {
      throw new Error(`feat131-replay-sensitive:${key}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeFixtureValue(item, `${key}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    const normalizedKey = childKey.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (
      FORBIDDEN_KEYS.has(childKey) ||
      SENSITIVE_KEY_PATTERN.test(normalizedKey) ||
      COMMERCE_KEY_PATTERN.test(normalizedKey)
    ) {
      throw new Error(`feat131-replay-sensitive:${childKey}`);
    }
    assertSafeFixtureValue(childValue, childKey);
  }
}

function parseSnapshot(value: unknown, label: string): ChatReplaySnapshot {
  const snapshot = record(value, label);
  exactKeys(snapshot, [
    "phase",
    "selectedSessionId",
    "liveAssistantText",
    "liveReasoningTexts",
    "liveTurnStatus",
    "historyAssistantText",
    "historyTurnStatus",
    "lastErrorCode",
    "controlPlaneState",
  ], label);
  const phase = stringValue(snapshot.phase, `${label}.phase`) as ChatViewPhase;
  if (!VIEW_PHASES.has(phase)) throw new Error(`feat131-replay-invalid:${label}.phase`);
  if (!Array.isArray(snapshot.liveReasoningTexts) || snapshot.liveReasoningTexts.length > 16) {
    throw new Error(`feat131-replay-invalid:${label}.liveReasoningTexts`);
  }
  return Object.freeze({
    phase,
    selectedSessionId: snapshot.selectedSessionId === null
      ? null
      : uuid(snapshot.selectedSessionId, `${label}.selectedSessionId`),
    liveAssistantText: stringValue(snapshot.liveAssistantText, `${label}.liveAssistantText`, true),
    liveReasoningTexts: Object.freeze(snapshot.liveReasoningTexts.map((item, index) =>
      stringValue(item, `${label}.liveReasoningTexts[${index}]`, true))),
    liveTurnStatus: nullableString(snapshot.liveTurnStatus, `${label}.liveTurnStatus`),
    historyAssistantText: nullableString(snapshot.historyAssistantText, `${label}.historyAssistantText`),
    historyTurnStatus: nullableString(snapshot.historyTurnStatus, `${label}.historyTurnStatus`),
    lastErrorCode: nullableString(snapshot.lastErrorCode, `${label}.lastErrorCode`),
    controlPlaneState: nullableString(snapshot.controlPlaneState, `${label}.controlPlaneState`),
  });
}

export function parseChatReplayFixture(value: unknown): ChatReplayFixture {
  assertSafeFixtureValue(value);
  const fixture = record(value, "fixture");
  exactKeys(fixture, [
    "fixtureSchemaVersion",
    "fixtureFamily",
    "referencePolicyId",
    "referencePolicyMode",
    "scenarioId",
    "provenance",
    "coveredVariants",
    "fixedNowEpochMs",
    "tenantSelector",
    "ids",
    "resyncSnapshots",
    "steps",
    "expectedAfterSettle",
  ], "fixture");
  if (
    fixture.fixtureSchemaVersion !== 2 ||
    fixture.fixtureFamily !== FEAT131_REPLAY_FIXTURE_FAMILY ||
    fixture.referencePolicyId !== FEAT131_REFERENCE_POLICY.id ||
    fixture.referencePolicyMode !== FEAT131_REFERENCE_POLICY.mode
  ) {
    throw new Error("feat131-replay-invalid:reference-policy");
  }
  const scenarioId = stringValue(fixture.scenarioId, "scenarioId");
  if (!SCENARIO_ID_PATTERN.test(scenarioId)) throw new Error("feat131-replay-invalid:scenarioId");
  const provenance = stringValue(fixture.provenance, "provenance") as ReplayProvenance;
  if (!new Set<ReplayProvenance>(["real-runtime", "synthetic"]).has(provenance)) {
    throw new Error("feat131-replay-invalid:provenance");
  }
  if (!Array.isArray(fixture.coveredVariants) || fixture.coveredVariants.length < 1 || fixture.coveredVariants.length > 8) {
    throw new Error("feat131-replay-invalid:coveredVariants");
  }
  const coveredVariants = Object.freeze(fixture.coveredVariants.map((variant, index) => {
    const parsed = stringValue(variant, `coveredVariants[${index}]`);
    if (!SAFE_NAME_PATTERN.test(parsed)) throw new Error("feat131-replay-invalid:coveredVariants");
    return parsed;
  }));
  if (new Set(coveredVariants).size !== coveredVariants.length) {
    throw new Error("feat131-replay-invalid:coveredVariants-duplicate");
  }
  if (!Number.isSafeInteger(fixture.fixedNowEpochMs) || (fixture.fixedNowEpochMs as number) <= 0) {
    throw new Error("feat131-replay-invalid:fixedNowEpochMs");
  }
  const tenantSelector = stringValue(fixture.tenantSelector, "tenantSelector");
  if (!SAFE_NAME_PATTERN.test(tenantSelector)) throw new Error("feat131-replay-invalid:tenantSelector");

  const ids = record(fixture.ids, "ids");
  exactKeys(ids, ["contextId", "projectId", "sessionId", "turnId", "subscriptionIds"], "ids");
  if (!Array.isArray(ids.subscriptionIds) || ids.subscriptionIds.length < 1 || ids.subscriptionIds.length > 8) {
    throw new Error("feat131-replay-invalid:subscriptionIds");
  }
  const subscriptionIds = Object.freeze(ids.subscriptionIds.map((item, index) =>
    uuid(item, `subscriptionIds[${index}]`)));
  if (new Set(subscriptionIds).size !== subscriptionIds.length) {
    throw new Error("feat131-replay-invalid:subscriptionIds-duplicate");
  }

  if (!Array.isArray(fixture.resyncSnapshots) || fixture.resyncSnapshots.length < 1 || fixture.resyncSnapshots.length > 8) {
    throw new Error("feat131-replay-invalid:resyncSnapshots");
  }
  if (fixture.resyncSnapshots.length !== subscriptionIds.length) {
    throw new Error("feat131-replay-invalid:bootstrap-queue-length");
  }
  const resyncSnapshots = Object.freeze(fixture.resyncSnapshots.map((item, index) =>
    record(item, `resyncSnapshots[${index}]`)));

  if (!Array.isArray(fixture.steps) || fixture.steps.length < 1 || fixture.steps.length > 32) {
    throw new Error("feat131-replay-invalid:steps");
  }
  const contextId = uuid(ids.contextId, "contextId");
  const sessionId = uuid(ids.sessionId, "sessionId");
  const steps = Object.freeze(fixture.steps.map((item, index): ChatReplayStep => {
    const step = record(item, `steps[${index}]`);
    exactKeys(step, ["event", "expect"], `steps[${index}]`);
    const event = record(step.event, `steps[${index}].event`);
    if (
      event.contextId !== contextId ||
      event.sessionId !== sessionId ||
      event.subscriptionId !== subscriptionIds[0]
    ) {
      throw new Error(`feat131-replay-invalid:steps[${index}].authority`);
    }
    return Object.freeze({
      event,
      expect: parseSnapshot(step.expect, `steps[${index}].expect`),
    });
  }));

  return Object.freeze({
    fixtureSchemaVersion: 2,
    fixtureFamily: FEAT131_REPLAY_FIXTURE_FAMILY,
    referencePolicyId: FEAT131_REFERENCE_POLICY.id,
    referencePolicyMode: FEAT131_REFERENCE_POLICY.mode,
    scenarioId,
    provenance,
    coveredVariants,
    fixedNowEpochMs: fixture.fixedNowEpochMs as number,
    tenantSelector,
    ids: Object.freeze({
      contextId,
      projectId: uuid(ids.projectId, "projectId"),
      sessionId,
      turnId: uuid(ids.turnId, "turnId"),
      subscriptionIds,
    }),
    resyncSnapshots,
    steps,
    expectedAfterSettle: parseSnapshot(fixture.expectedAfterSettle, "expectedAfterSettle"),
  });
}

export function parseFeat131ScenarioCatalog(value: unknown): Feat131ScenarioCatalog {
  assertSafeFixtureValue(value);
  const catalog = record(value, "catalog");
  exactKeys(catalog, [
    "catalogSchemaVersion",
    "fixtureFamily",
    "referencePolicyId",
    "referencePolicyMode",
    "policyEffectiveAt",
    "scenarios",
  ], "catalog");
  if (
    catalog.catalogSchemaVersion !== 2 ||
    catalog.fixtureFamily !== FEAT131_REPLAY_FIXTURE_FAMILY ||
    catalog.referencePolicyId !== FEAT131_REFERENCE_POLICY.id ||
    catalog.referencePolicyMode !== FEAT131_REFERENCE_POLICY.mode
  ) {
    throw new Error("feat131-catalog-invalid:reference-policy");
  }
  const policyEffectiveAt = stringValue(catalog.policyEffectiveAt, "catalog.policyEffectiveAt");
  if (!/^20[0-9]{2}-[01][0-9]-[0-3][0-9]$/.test(policyEffectiveAt)) {
    throw new Error("feat131-catalog-invalid:policyEffectiveAt");
  }
  if (!Array.isArray(catalog.scenarios) || catalog.scenarios.length < 13 || catalog.scenarios.length > 64) {
    throw new Error("feat131-catalog-invalid:scenarios");
  }
  const scenarios = Object.freeze(catalog.scenarios.map((item, index): Feat131ScenarioCatalogEntry => {
    const entry = record(item, `catalog.scenarios[${index}]`);
    exactKeys(entry, [
      "scenarioId",
      "title",
      "variants",
      "ownerFeature",
      "capabilityClass",
      "assetKind",
      "replayedVariants",
      "provenance",
      "referenceBasis",
      "replayFixture",
    ], `catalog.scenarios[${index}]`);
    const scenarioId = stringValue(entry.scenarioId, `catalog.scenarios[${index}].scenarioId`);
    if (!SCENARIO_ID_PATTERN.test(scenarioId)) {
      throw new Error(`feat131-catalog-invalid:scenarioId:${index}`);
    }
    if (!Array.isArray(entry.variants) || entry.variants.length < 1 || entry.variants.length > 8) {
      throw new Error(`feat131-catalog-invalid:variants:${index}`);
    }
    const variants = Object.freeze(entry.variants.map((variant, variantIndex) =>
      stringValue(variant, `catalog.scenarios[${index}].variants[${variantIndex}]`)));
    if (new Set(variants).size !== variants.length) {
      throw new Error(`feat131-catalog-invalid:variants-duplicate:${index}`);
    }
    const capabilityClass = stringValue(entry.capabilityClass, `catalog.scenarios[${index}].capabilityClass`);
    if (!CAPABILITY_CLASSES.has(capabilityClass)) {
      throw new Error(`feat131-catalog-invalid:capabilityClass:${index}`);
    }
    const assetKind = stringValue(entry.assetKind, `catalog.scenarios[${index}].assetKind`);
    if (assetKind !== "replay" && assetKind !== "metadata-only") {
      throw new Error(`feat131-catalog-invalid:assetKind:${index}`);
    }
    if (!Array.isArray(entry.replayedVariants) || entry.replayedVariants.length > variants.length) {
      throw new Error(`feat131-catalog-invalid:replayedVariants:${index}`);
    }
    const replayedVariants = Object.freeze(entry.replayedVariants.map((variant, variantIndex) =>
      stringValue(variant, `catalog.scenarios[${index}].replayedVariants[${variantIndex}]`)));
    if (
      new Set(replayedVariants).size !== replayedVariants.length ||
      replayedVariants.some((variant) => !variants.includes(variant))
    ) {
      throw new Error(`feat131-catalog-invalid:replayedVariants:${index}`);
    }
    const referenceBasis = stringValue(
      entry.referenceBasis,
      `catalog.scenarios[${index}].referenceBasis`,
    ) as ReplayReferenceBasis;
    if (referenceBasis !== "owner-approved-inference" && referenceBasis !== "owner-excluded") {
      throw new Error(`feat131-catalog-invalid:referenceBasis:${index}`);
    }
    const provenance = entry.provenance === null
      ? null
      : stringValue(entry.provenance, `catalog.scenarios[${index}].provenance`) as ReplayProvenance;
    if (
      provenance !== null &&
      provenance !== "real-runtime" &&
      provenance !== "synthetic"
    ) {
      throw new Error(`feat131-catalog-invalid:provenance:${index}`);
    }
    const replayFixture = entry.replayFixture === null
      ? null
      : stringValue(entry.replayFixture, `catalog.scenarios[${index}].replayFixture`);
    if (assetKind === "replay") {
      if (
        replayedVariants.length === 0 ||
        provenance === null ||
        replayFixture === null ||
        !SAFE_NAME_PATTERN.test(replayFixture)
      ) {
        throw new Error(`feat131-catalog-invalid:replay:${index}`);
      }
    } else if (replayedVariants.length !== 0 || provenance !== null || replayFixture !== null) {
      throw new Error(`feat131-catalog-invalid:metadata-only:${index}`);
    }
    if (scenarioId === "GS-006") {
      if (
        referenceBasis !== "owner-excluded" ||
        capabilityClass !== "intentional product difference" ||
        entry.ownerFeature !== "FEAT-131" ||
        assetKind !== "metadata-only"
      ) {
        throw new Error("feat131-catalog-invalid:GS-006-owner-exclusion");
      }
    } else if (referenceBasis !== "owner-approved-inference") {
      throw new Error(`feat131-catalog-invalid:referenceBasis:${index}`);
    }
    return Object.freeze({
      scenarioId,
      title: stringValue(entry.title, `catalog.scenarios[${index}].title`),
      variants,
      ownerFeature: stringValue(entry.ownerFeature, `catalog.scenarios[${index}].ownerFeature`),
      capabilityClass,
      assetKind,
      replayedVariants,
      provenance,
      referenceBasis,
      replayFixture,
    });
  }));
  const scenarioIds = scenarios.map((entry) => entry.scenarioId);
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error("feat131-catalog-invalid:duplicate-scenarioId");
  }
  if (JSON.stringify([...scenarioIds].sort()) !== JSON.stringify([...FEAT131_REQUIRED_SCENARIO_IDS].sort())) {
    throw new Error("feat131-catalog-invalid:required-scenarios");
  }
  return Object.freeze({
    catalogSchemaVersion: 2,
    fixtureFamily: FEAT131_REPLAY_FIXTURE_FAMILY,
    referencePolicyId: FEAT131_REFERENCE_POLICY.id,
    referencePolicyMode: FEAT131_REFERENCE_POLICY.mode,
    policyEffectiveAt,
    scenarios,
  });
}

function requestEnvelope(
  arguments_: Record<string, unknown> | undefined,
  expectedVersion: 1 | 2,
  expectedContextId?: string,
): Readonly<{ requestId: string; payload: JsonRecord }> {
  const outer = record(arguments_, "transport.arguments");
  exactKeys(outer, ["request"], "transport.arguments");
  const request = record(outer.request, "transport.request");
  exactKeys(
    request,
    expectedContextId === undefined
      ? ["schemaVersion", "requestId", "payload"]
      : ["schemaVersion", "requestId", "contextId", "payload"],
    "transport.request",
  );
  if (request.schemaVersion !== expectedVersion || (expectedContextId !== undefined && request.contextId !== expectedContextId)) {
    throw new Error("feat131-replay-transport-request-invalid");
  }
  return Object.freeze({
    requestId: uuid(request.requestId, "transport.requestId"),
    payload: record(request.payload, "transport.payload"),
  });
}

function response(schemaVersion: 1 | 2, requestId: string, data: unknown): JsonRecord {
  return { schemaVersion, requestId, data };
}

class ReplayTransport implements ChatClientTransport {
  readonly calls: string[] = [];
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly subscriptions: string[];
  private readonly snapshots: JsonRecord[];

  constructor(private readonly fixture: ChatReplayFixture) {
    this.subscriptions = [...fixture.ids.subscriptionIds];
    this.snapshots = [...fixture.resyncSnapshots];
  }

  invoke(command: string, arguments_?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(command);
    const operation = Promise.resolve().then(() => this.route(command, arguments_));
    this.pending.add(operation);
    void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
    return operation;
  }

  async listen(channel: string, handler: (payload: unknown) => void): Promise<() => void> {
    if (
      channel !== CHAT_EVENT_CHANNEL &&
      channel !== CHAT_CONTROL_PLANE_EVENT_CHANNEL &&
      channel !== CHAT_ATTACHMENT_IMPORT_EVENT_CHANNEL
    ) {
      throw new Error(`feat131-replay-listen-unknown:${channel}`);
    }
    const handlers = this.listeners.get(channel) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.listeners.set(channel, handlers);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.listeners.delete(channel);
    };
  }

  emit(channel: string, payload: unknown): void {
    const handlers = this.listeners.get(channel);
    if (!handlers || handlers.size === 0) throw new Error(`feat131-replay-listener-missing:${channel}`);
    for (const handler of [...handlers]) handler(payload);
  }

  async settle(): Promise<void> {
    let stableEmptyPasses = 0;
    for (let pass = 0; pass < 64; pass += 1) {
      await Promise.resolve();
      const current = [...this.pending];
      if (current.length > 0) await Promise.allSettled(current);
      await Promise.resolve();
      if (this.pending.size === 0) {
        stableEmptyPasses += 1;
        if (stableEmptyPasses >= 4) return;
      } else {
        stableEmptyPasses = 0;
      }
    }
    throw new Error("feat131-replay-settle-budget-exceeded");
  }

  assertConsumed(): void {
    if (this.subscriptions.length !== 0 || this.snapshots.length !== 0) {
      throw new Error("feat131-replay-fixture-not-consumed");
    }
  }

  listenerCount(): number {
    return [...this.listeners.values()].reduce((total, handlers) => total + handlers.size, 0);
  }

  private route(command: string, arguments_: Record<string, unknown> | undefined): unknown {
    const initial = this.fixture.resyncSnapshots[0];
    const initialSession = record(initial.session, "initial.session");
    switch (command) {
      case "chat_bind_context_v1": {
        const request = requestEnvelope(arguments_, 1);
        if (request.payload.tenantSelector !== this.fixture.tenantSelector) {
          throw new Error("feat131-replay-tenant-selector-invalid");
        }
        return response(1, request.requestId, {
          contextId: this.fixture.ids.contextId,
          expiresAtEpochSeconds: Math.floor(this.fixture.fixedNowEpochMs / 1000) + 3600,
          allowedActions: ["read_sessions", "read_projects", "read_cleanup"],
        });
      }
      case "chat_list_projects_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, []);
      }
      case "chat_list_sessions_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, { sessions: [initialSession], nextCursor: null });
      }
      case "chat_get_local_readiness_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, {
          lifecycle: "ready",
          host: "ready",
          runtime: "ready",
          storage: "ready",
          canSend: true,
          issueCode: null,
          retryable: false,
          recovery: "none",
        });
      }
      case "chat_subscribe_session_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        if (request.payload.sessionId !== this.fixture.ids.sessionId) {
          throw new Error("feat131-replay-session-invalid");
        }
        const subscriptionId = this.subscriptions.shift();
        if (!subscriptionId) throw new Error("feat131-replay-subscription-exhausted");
        return response(1, request.requestId, { subscriptionId });
      }
      case "chat_resync_session_v2": {
        const request = requestEnvelope(arguments_, 2, this.fixture.ids.contextId);
        if (request.payload.sessionId !== this.fixture.ids.sessionId) {
          throw new Error("feat131-replay-session-invalid");
        }
        const snapshot = this.snapshots.shift();
        if (!snapshot) throw new Error("feat131-replay-snapshot-exhausted");
        return response(2, request.requestId, snapshot);
      }
      case "chat_get_session_control_plane_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, {
          sessionId: this.fixture.ids.sessionId,
          state: "bound",
          issueCode: null,
          retryable: false,
          recovery: "none",
        });
      }
      case "chat_unsubscribe_session_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, { cancelled: true });
      }
      case "chat_cancel_request_v1": {
        const request = requestEnvelope(arguments_, 1, this.fixture.ids.contextId);
        return response(1, request.requestId, { cancelled: true });
      }
      default:
        throw new Error(`feat131-replay-command-unsupported:${command}`);
    }
  }
}

type ChatReplayStore = ReturnType<ReturnType<typeof createChatStoreDefinition>>;

export function snapshotChatReplay(store: ChatReplayStore): ChatReplaySnapshot {
  const historyTurn = store.history?.turns[0] ?? null;
  const historyAssistant = historyTurn?.messages.find((message) => message.role === "assistant") ?? null;
  return Object.freeze({
    phase: store.phase,
    selectedSessionId: store.selectedSessionId,
    liveAssistantText: store.liveAssistantText,
    liveReasoningTexts: Object.freeze(store.liveReasoning.map((part) => part.text)),
    liveTurnStatus: store.liveTurnStatus,
    historyAssistantText: historyAssistant?.content ?? null,
    historyTurnStatus: historyTurn?.status ?? null,
    lastErrorCode: store.lastErrorCode,
    controlPlaneState: store.controlPlane?.state ?? null,
  });
}

export interface ChatEventReplayHarness {
  readonly fixture: ChatReplayFixture;
  readonly store: ChatReplayStore;
  emit(step: ChatReplayStep): ChatReplaySnapshot;
  settle(): Promise<void>;
  snapshot(): ChatReplaySnapshot;
  assertConsumed(): void;
  callCount(command: string): number;
  listenerCount(): number;
  dispose(): Promise<void>;
}

export async function createChatEventReplayHarness(value: unknown): Promise<ChatEventReplayHarness> {
  void FEAT131_REPLAY_HARNESS_CANARY;
  const fixture = parseChatReplayFixture(value);
  const transport = new ReplayTransport(fixture);
  const client = createChatClient(transport);
  const storeDefinition = createChatStoreDefinition(client, `feat131-replay-${fixture.scenarioId}`);
  const store = storeDefinition(createPinia());
  await store.bind(fixture.tenantSelector);
  if (store.phase !== "ready") throw new Error(`feat131-replay-bootstrap-bind:${store.phase}`);
  await store.selectSession(fixture.ids.sessionId);
  if (store.phase !== "ready") throw new Error(`feat131-replay-bootstrap-select:${store.phase}`);

  return Object.freeze({
    fixture,
    store,
    emit(step: ChatReplayStep) {
      transport.emit(CHAT_EVENT_CHANNEL, step.event);
      return snapshotChatReplay(store);
    },
    settle: () => transport.settle(),
    snapshot: () => snapshotChatReplay(store),
    assertConsumed: () => transport.assertConsumed(),
    callCount: (command: string) => transport.calls.filter((candidate) => candidate === command).length,
    listenerCount: () => transport.listenerCount(),
    async dispose() {
      await store.dispose();
      await transport.settle();
    },
  });
}
