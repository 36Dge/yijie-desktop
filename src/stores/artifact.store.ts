import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { ChatArtifact, ChatHistoryPage } from "../domain/chat-ipc";
import {
  createArtifactProjection,
  reduceArtifactList,
  type ArtifactProjection,
} from "../domain/chat-artifact";

const STORE_ID = "chat-artifacts";
const EMPTY_ARTIFACTS: readonly ArtifactProjection[] = Object.freeze([]);

type TurnArtifactIndex = Readonly<Record<string, readonly ArtifactProjection[]>>;
type SessionArtifactIndex = Readonly<Record<string, TurnArtifactIndex>>;

function updateTurn(
  sessions: SessionArtifactIndex,
  sessionId: string,
  turnId: string,
  incoming: ArtifactProjection,
): SessionArtifactIndex {
  const session = sessions[sessionId] ?? Object.freeze({});
  const current = session[turnId] ?? EMPTY_ARTIFACTS;
  const updated = reduceArtifactList(current, incoming);
  if (updated === current) return sessions;
  const updatedSession = Object.freeze({ ...session, [turnId]: updated });
  return Object.freeze({ ...sessions, [sessionId]: updatedSession });
}

export function createArtifactStoreDefinition(storeId = STORE_ID) {
  return defineStore(storeId, () => {
    const activeSessionId = ref<string | null>(null);
    const sessions = shallowRef<SessionArtifactIndex>(Object.freeze({}));
    const activeArtifacts = computed<readonly ArtifactProjection[]>(() => {
      if (activeSessionId.value === null) return EMPTY_ARTIFACTS;
      const turns = sessions.value[activeSessionId.value];
      if (turns === undefined) return EMPTY_ARTIFACTS;
      return Object.freeze(Object.values(turns).flat());
    });

    function artifactsForTurn(sessionId: string, turnId: string): readonly ArtifactProjection[] {
      return sessions.value[sessionId]?.[turnId] ?? EMPTY_ARTIFACTS;
    }

    function applyProjection(sessionId: string, turnId: string, artifact: ChatArtifact): void {
      sessions.value = updateTurn(
        sessions.value,
        sessionId,
        turnId,
        createArtifactProjection(sessionId, turnId, artifact),
      );
    }

    function ingestHistoryV3(sessionId: string, history: ChatHistoryPage): void {
      let updated = sessions.value;
      for (const turn of history.turns) {
        for (const artifact of turn.artifacts ?? EMPTY_ARTIFACTS) {
          updated = updateTurn(
            updated,
            sessionId,
            turn.turnId,
            createArtifactProjection(sessionId, turn.turnId, artifact),
          );
        }
      }
      sessions.value = updated;
    }

    function selectSession(sessionId: string | null): void {
      activeSessionId.value = sessionId;
    }

    return {
      activeSessionId,
      activeArtifacts,
      artifactsForTurn,
      applyProjection,
      ingestHistoryV3,
      selectSession,
    };
  });
}

export const useArtifactStore = createArtifactStoreDefinition();
