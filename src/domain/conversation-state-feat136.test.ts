import { describe, expect, it } from "vitest";
import {
  createConversationState,
  hydrateConversationState,
  MAX_CONVERSATION_COMMAND_OUTPUT_BYTES,
  reconcileConversationSnapshot,
  reduceConversationEvent,
  reduceConversationEvents,
  selectConversationItem,
  serializeConversationState,
  type ConversationEvent,
  type ConversationSnapshot,
} from "./conversation-state";
import { selectConversationTimeline } from "./conversation-timeline";

const THREAD_ID = "thread-feat136";
const TURN_ID = "turn-feat136";
const STREAM_ID = "stream-feat136";

function cursor(sequence: number, eventId = `event-${sequence}`) {
  return {
    eventId,
    streamId: STREAM_ID,
    sequence: String(sequence),
    threadId: THREAD_ID,
    turnId: TURN_ID,
  } as const;
}

function source(sequence: number) {
  return {
    sourceEventId: `source-${sequence}`,
    sourceSequence: String(sequence),
    sourceOccurredAt: "2026-08-29T08:00:00Z",
  } as const;
}

const summary = Object.freeze({
  text: "Read repository status",
  truncated: false,
  truncationReason: null,
});
const completedSummary = Object.freeze({
  text: "Search repository symbols",
  truncated: false,
  truncationReason: null,
});
const cwd = Object.freeze({ kind: "workspace_root" as const, segments: Object.freeze([]) });
const completedCwd = Object.freeze({
  kind: "workspace_relative" as const,
  segments: Object.freeze(["src", "domain"]),
});
const knownIdentity = Object.freeze({
  resolution: "known" as const,
  serverName: "workspace",
  toolName: "read_catalog",
});
const unknownIdentity = Object.freeze({
  resolution: "unknown" as const,
  serverName: "unknown",
  toolName: "unknown",
});
const argumentsSummary = Object.freeze({
  text: "one argument",
  truncated: false,
  truncationReason: null,
});
const completedArgumentsSummary = Object.freeze({
  text: "two arguments",
  truncated: false,
  truncationReason: null,
});

function commandStarted(sequence = 1): ConversationEvent {
  return {
    ...cursor(sequence),
    ...source(sequence),
    kind: "command.started",
    itemId: "command-1",
    ordinal: 1,
    commandSummary: summary,
    cwd,
  };
}

function commandDelta(
  sequence: number,
  text: string,
  eventId = `event-${sequence}`,
): ConversationEvent {
  return {
    ...cursor(sequence, eventId),
    ...source(sequence),
    kind: "command.output.delta",
    itemId: "command-1",
    ordinal: 1,
    text,
    truncated: false,
    truncationReason: null,
  };
}

function commandCompleted(sequence: number, eventId = `event-${sequence}`): ConversationEvent {
  return {
    ...cursor(sequence, eventId),
    ...source(sequence),
    kind: "command.completed",
    itemId: "command-1",
    ordinal: 1,
    status: "completed",
    commandSummary: completedSummary,
    cwd: completedCwd,
    durationMs: 12,
    exitCode: 0,
    output: {
      retention: "complete",
      text: "authoritative output\n",
      head: null,
      tail: null,
      reason: null,
      truncated: false,
      truncationReason: null,
    },
    error: null,
  };
}

function toolCompleted(sequence: number, eventId = `event-${sequence}`): ConversationEvent {
  return {
    ...cursor(sequence, eventId),
    ...source(sequence),
    kind: "tool.completed",
    itemId: "tool-completed-first",
    ordinal: 2,
    status: "failed",
    identity: knownIdentity,
    argumentsSummary: completedArgumentsSummary,
    durationMs: 18,
    resultSummary: {
      text: "safe completed result",
      truncated: false,
      truncationReason: null,
    },
    error: { code: "tool_failed", summary: "safe failure summary" },
  };
}

describe("FEAT-136 execution conversation state", () => {
  it("projects Command and Tool as first-class timeline items with typed execution snapshots", () => {
    const state = reduceConversationEvents(createConversationState(), [
      commandStarted(),
      commandDelta(2, "live output\n"),
      commandCompleted(3),
      {
        ...cursor(4, "tool-started"),
        ...source(4),
        kind: "tool.started",
        itemId: "tool-known",
        ordinal: 2,
        identity: knownIdentity,
        argumentsSummary,
      },
    ]);

    const items = selectConversationTimeline(state, THREAD_ID)?.turns[0]?.items;
    expect(items).toHaveLength(2);
    expect(items?.[0]).toMatchObject({
      kind: "command",
      presentation: "command",
      role: "process",
      contentMode: "plain",
      copyPolicy: "none",
      execution: {
        kind: "command",
        status: "completed",
        output: { retention: "complete", text: "authoritative output\n" },
      },
    });
    expect(items?.[1]).toMatchObject({
      kind: "tool",
      presentation: "tool",
      role: "process",
      contentMode: "plain",
      copyPolicy: "none",
      execution: {
        kind: "tool",
        status: "in_progress",
        identity: knownIdentity,
      },
    });
  });

  it("deduplicates by event identity before sequence and retains equal text with distinct IDs", () => {
    const started = reduceConversationEvent(createConversationState(), commandStarted());
    const first = reduceConversationEvent(started, commandDelta(2, "same\n", "delta-a"));
    const replay = reduceConversationEvent(first, {
      ...commandDelta(2, "same\n", "delta-a"),
      sequence: "99",
    });
    expect(replay).toBe(first);

    const repeated = reduceConversationEvent(first, commandDelta(3, "same\n", "delta-b"));
    const item = selectConversationItem(repeated, THREAD_ID, TURN_ID, "command-1");
    expect(item?.execution?.kind).toBe("command");
    if (item?.execution?.kind === "command") {
      expect(item.execution.liveOutput?.text).toBe("same\nsame\n");
    }

    const conflict = reduceConversationEvent(first, commandDelta(3, "different\n", "delta-a"));
    expect(conflict.recovery?.code).toBe("event_id_conflict");
  });

  it("uses the completed Command snapshot as authority and seals against late mutation", () => {
    const completed = reduceConversationEvents(createConversationState(), [
      commandStarted(),
      commandDelta(2, "live output\n"),
      commandCompleted(3),
    ]);
    const execution = selectConversationItem(
      completed,
      THREAD_ID,
      TURN_ID,
      "command-1",
    )?.execution;
    expect(execution?.kind).toBe("command");
    if (execution?.kind === "command") {
      expect(execution.liveOutput?.text).toBe("live output\n");
      expect(execution.commandSummary).toEqual(completedSummary);
      expect(execution.cwd).toEqual(completedCwd);
      expect(execution.output).toMatchObject({
        retention: "complete",
        text: "authoritative output\n",
      });
    }

    const late = reduceConversationEvent(completed, commandDelta(4, "late\n"));
    expect(late.recovery?.code).toBe("invalid_transition");
    const duplicateSeal = reduceConversationEvent(completed, commandCompleted(4, "new-seal-id"));
    expect(duplicateSeal.recovery?.code).toBe("invalid_transition");
  });

  it("materializes an authoritative sealed Command when completed arrives before started", () => {
    const completedEvent = commandCompleted(1, "command-completed-first");
    const sealed = reduceConversationEvent(createConversationState(), completedEvent);
    const item = selectConversationItem(sealed, THREAD_ID, TURN_ID, "command-1");

    expect(item).toMatchObject({
      kind: "command",
      ordinal: 1,
      status: "completed",
      reconciliation: "matched",
      execution: {
        kind: "command",
        status: "completed",
        startedSource: source(1),
        lastSource: source(1),
        commandSummary: completedSummary,
        cwd: completedCwd,
        liveOutput: null,
        output: { retention: "complete", text: "authoritative output\n" },
        durationMs: 12,
        exitCode: 0,
        error: null,
      },
    });
    expect(reduceConversationEvent(sealed, completedEvent)).toBe(sealed);

    const late = reduceConversationEvent(sealed, commandDelta(2, "late\n", "late-after-seal"));
    expect(late.recovery?.code).toBe("invalid_transition");
    const secondSeal = reduceConversationEvent(
      sealed,
      commandCompleted(2, "command-second-seal"),
    );
    expect(secondSeal.recovery?.code).toBe("invalid_transition");
  });

  it("materializes an authoritative sealed Tool when completed arrives before started", () => {
    const completedEvent = toolCompleted(1, "tool-completed-first-event");
    const sealed = reduceConversationEvent(createConversationState(), completedEvent);
    const item = selectConversationItem(
      sealed,
      THREAD_ID,
      TURN_ID,
      "tool-completed-first",
    );

    expect(item).toMatchObject({
      kind: "tool",
      ordinal: 2,
      status: "completed",
      reconciliation: "matched",
      execution: {
        kind: "tool",
        status: "failed",
        startedSource: source(1),
        lastSource: source(1),
        identity: knownIdentity,
        argumentsSummary: completedArgumentsSummary,
        progress: [],
        durationMs: 18,
        resultSummary: { text: "safe completed result" },
        error: { code: "tool_failed", summary: "safe failure summary" },
      },
    });
    expect(reduceConversationEvent(sealed, completedEvent)).toBe(sealed);

    const late = reduceConversationEvent(sealed, {
      ...cursor(2, "tool-progress-after-seal"),
      ...source(2),
      kind: "tool.progress",
      itemId: "tool-completed-first",
      ordinal: 2,
      identity: knownIdentity,
      progressIndex: 0,
      summary: { text: "late progress", truncated: false, truncationReason: null },
    });
    expect(late.recovery?.code).toBe("invalid_transition");
    const secondSeal = reduceConversationEvent(
      sealed,
      toolCompleted(2, "tool-second-seal"),
    );
    expect(secondSeal.recovery?.code).toBe("invalid_transition");
  });

  it("lets a sealed history snapshot replace differing live-safe execution fields", () => {
    const live = reduceConversationEvents(createConversationState(), [
      commandStarted(),
      {
        ...cursor(2, "live-tool-started"),
        ...source(2),
        kind: "tool.started",
        itemId: "tool-authority",
        ordinal: 2,
        identity: unknownIdentity,
        argumentsSummary,
      },
    ]);
    const authoritative = reduceConversationEvents(createConversationState(), [
      commandStarted(),
      commandCompleted(2),
      {
        ...cursor(3, "authority-tool-started"),
        ...source(3),
        kind: "tool.started",
        itemId: "tool-authority",
        ordinal: 2,
        identity: unknownIdentity,
        argumentsSummary,
      },
      {
        ...cursor(4, "authority-tool-completed"),
        ...source(4),
        kind: "tool.completed",
        itemId: "tool-authority",
        ordinal: 2,
        status: "completed",
        identity: knownIdentity,
        argumentsSummary: completedArgumentsSummary,
        durationMs: 5,
        resultSummary: { text: "safe result", truncated: false, truncationReason: null },
        error: null,
      },
    ]);
    const authorityCommand = selectConversationItem(
      authoritative,
      THREAD_ID,
      TURN_ID,
      "command-1",
    )!;
    const authorityTool = selectConversationItem(
      authoritative,
      THREAD_ID,
      TURN_ID,
      "tool-authority",
    )!;
    const snapshot: ConversationSnapshot = {
      schemaVersion: 3,
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: [authorityCommand, authorityTool].map((item) => ({
        threadId: item.threadId,
        turnId: item.turnId,
        itemId: item.itemId,
        ordinal: item.ordinal,
        kind: item.kind,
        status: item.status,
        execution: item.execution,
        contentBlocks: [],
      })),
    };

    const reconciled = reconcileConversationSnapshot(live, snapshot);
    expect(reconciled.syncStatus).toBe("synchronized");
    expect(selectConversationItem(reconciled, THREAD_ID, TURN_ID, "command-1")?.execution)
      .toMatchObject({ commandSummary: completedSummary, cwd: completedCwd });
    expect(selectConversationItem(reconciled, THREAD_ID, TURN_ID, "tool-authority")?.execution)
      .toMatchObject({ identity: knownIdentity, argumentsSummary: completedArgumentsSummary });
  });

  it("bounds the derived live Command aggregate at 256 KiB with explicit truncation", () => {
    const chunk = "x".repeat(16 * 1024);
    const events: ConversationEvent[] = [commandStarted()];
    for (let index = 0; index < 17; index += 1) {
      events.push(commandDelta(index + 2, chunk));
    }
    const state = reduceConversationEvents(createConversationState(), events);
    const execution = selectConversationItem(state, THREAD_ID, TURN_ID, "command-1")?.execution;
    expect(execution?.kind).toBe("command");
    if (execution?.kind === "command") {
      expect(new TextEncoder().encode(execution.liveOutput?.text ?? "")).toHaveLength(
        MAX_CONVERSATION_COMMAND_OUTPUT_BYTES,
      );
      expect(execution.liveOutput).toMatchObject({
        truncated: true,
        truncationReason: "utf8_byte_limit",
      });
    }
  });

  it("retains an unknown Tool as Tool, preserves repeated progress, and seals failed-with-result", () => {
    const events: ConversationEvent[] = [{
      ...cursor(1),
      ...source(1),
      kind: "tool.started",
      itemId: "tool-unknown",
      ordinal: 2,
      identity: unknownIdentity,
      argumentsSummary,
    }];
    for (let index = 0; index < 2; index += 1) {
      events.push({
        ...cursor(index + 2, `tool-progress-${index}`),
        ...source(index + 2),
        kind: "tool.progress",
        itemId: "tool-unknown",
        ordinal: 2,
        identity: unknownIdentity,
        progressIndex: index,
        summary: { text: "same progress", truncated: false, truncationReason: null },
      });
    }
    events.push({
      ...cursor(4),
      ...source(4),
      kind: "tool.completed",
      itemId: "tool-unknown",
      ordinal: 2,
      status: "failed",
      identity: unknownIdentity,
      argumentsSummary: completedArgumentsSummary,
      durationMs: 18,
      resultSummary: { text: "one safe result part", truncated: false, truncationReason: null },
      error: { code: "unknown_tool", summary: "tool is not registered" },
    });

    const state = reduceConversationEvents(createConversationState(), events);
    const item = selectConversationItem(state, THREAD_ID, TURN_ID, "tool-unknown");
    expect(item?.kind).toBe("tool");
    expect(item?.status).toBe("completed");
    expect(item?.execution).toMatchObject({
      kind: "tool",
      status: "failed",
      identity: unknownIdentity,
      argumentsSummary: completedArgumentsSummary,
      progress: [{ progressIndex: 0 }, { progressIndex: 1 }],
      resultSummary: { text: "one safe result part" },
      error: { code: "unknown_tool" },
    });
  });

  it("enforces the 32 progress event cap without manufacturing a Tool outcome", () => {
    const events: ConversationEvent[] = [{
      ...cursor(1),
      ...source(1),
      kind: "tool.started",
      itemId: "tool-known",
      ordinal: 2,
      identity: knownIdentity,
      argumentsSummary,
    }];
    for (let index = 0; index < 32; index += 1) {
      events.push({
        ...cursor(index + 2),
        ...source(index + 2),
        kind: "tool.progress",
        itemId: "tool-known",
        ordinal: 2,
        identity: knownIdentity,
        progressIndex: index,
        summary: { text: "progress", truncated: false, truncationReason: null },
      });
    }
    const full = reduceConversationEvents(createConversationState(), events);
    expect(selectConversationItem(full, THREAD_ID, TURN_ID, "tool-known")?.execution)
      .toMatchObject({ kind: "tool", status: "in_progress", progress: { length: 32 } });

    const overflow = reduceConversationEvent(full, {
      ...cursor(34),
      ...source(34),
      kind: "tool.progress",
      itemId: "tool-known",
      ordinal: 2,
      identity: knownIdentity,
      progressIndex: 32,
      summary: { text: "one extra", truncated: false, truncationReason: null },
    });
    expect(overflow.recovery?.code).toBe("invalid_transition");
    expect(selectConversationItem(overflow, THREAD_ID, TURN_ID, "tool-known")?.execution)
      .toMatchObject({ kind: "tool", status: "in_progress" });
  });

  it("hydrates v3 execution authority and migrates a v2 non-execution snapshot", () => {
    const completed = reduceConversationEvents(createConversationState(), [
      commandStarted(),
      commandDelta(2, "live output\n"),
      commandCompleted(3),
      {
        ...cursor(4, "hydrate-tool-started"),
        ...source(4),
        kind: "tool.started",
        itemId: "tool-hydration",
        ordinal: 2,
        identity: knownIdentity,
        argumentsSummary,
      },
      {
        ...cursor(5, "hydrate-tool-completed"),
        ...source(5),
        kind: "tool.completed",
        itemId: "tool-hydration",
        ordinal: 2,
        status: "completed",
        identity: knownIdentity,
        argumentsSummary: completedArgumentsSummary,
        durationMs: 9,
        resultSummary: { text: "safe result", truncated: false, truncationReason: null },
        error: null,
      },
    ]);
    const command = selectConversationItem(completed, THREAD_ID, TURN_ID, "command-1")!;
    const tool = selectConversationItem(completed, THREAD_ID, TURN_ID, "tool-hydration")!;
    const snapshot: ConversationSnapshot = {
      schemaVersion: 3,
      threads: [{ threadId: THREAD_ID, status: "active" }],
      turns: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        ordinal: 0,
        status: "in_progress",
        terminalStatus: null,
      }],
      items: [{
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: command.itemId,
        ordinal: command.ordinal,
        kind: "command",
        status: "completed",
        execution: command.execution,
        contentBlocks: [],
      }, {
        threadId: THREAD_ID,
        turnId: TURN_ID,
        itemId: tool.itemId,
        ordinal: tool.ordinal,
        kind: "tool",
        status: "completed",
        execution: tool.execution,
        contentBlocks: [],
      }],
    };
    const hydrated = hydrateConversationState(snapshot);
    expect(hydrated.schemaVersion).toBe(3);
    expect(selectConversationItem(hydrated, THREAD_ID, TURN_ID, "command-1")?.execution)
      .toMatchObject({
        kind: "command",
        commandSummary: completedSummary,
        cwd: completedCwd,
        output: { text: "authoritative output\n" },
      });
    expect(selectConversationItem(hydrated, THREAD_ID, TURN_ID, "tool-hydration")?.execution)
      .toMatchObject({ kind: "tool", argumentsSummary: completedArgumentsSummary });
    expect(serializeConversationState(hydrated)).toContain('"execution":{"kind":"command"');

    const migrated = hydrateConversationState({
      schemaVersion: 2,
      threads: [{ threadId: "legacy", status: "ready" }],
      turns: [],
      items: [],
    });
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.syncStatus).toBe("synchronized");
  });
});
