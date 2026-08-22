import { computed, shallowRef } from "vue";
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

export interface ArtifactAuthority {
  readonly authorizationRevision: number;
  readonly contextId: string;
  readonly tenantId: string;
  readonly sessionId: string;
}

export interface ArtifactAuthorityToken {
  readonly epoch: number;
  readonly authority: ArtifactAuthority;
}

function sameAuthority(left: ArtifactAuthority | null, right: ArtifactAuthority): boolean {
  return left !== null &&
    left.authorizationRevision === right.authorizationRevision &&
    left.contextId === right.contextId &&
    left.tenantId === right.tenantId &&
    left.sessionId === right.sessionId;
}

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
    const authority = shallowRef<ArtifactAuthority | null>(null);
    const sessions = shallowRef<SessionArtifactIndex>(Object.freeze({}));
    let authorityEpoch = 0;
    const activeArtifacts = computed<readonly ArtifactProjection[]>(() => {
      if (authority.value === null) return EMPTY_ARTIFACTS;
      const turns = sessions.value[authority.value.sessionId];
      if (turns === undefined) return EMPTY_ARTIFACTS;
      return Object.freeze(Object.values(turns).flat());
    });

    function artifactsForTurn(sessionId: string, turnId: string): readonly ArtifactProjection[] {
      if (authority.value?.sessionId !== sessionId) return EMPTY_ARTIFACTS;
      return sessions.value[sessionId]?.[turnId] ?? EMPTY_ARTIFACTS;
    }

    function isCurrent(token: ArtifactAuthorityToken | null): token is ArtifactAuthorityToken {
      return token !== null && token.epoch === authorityEpoch && sameAuthority(authority.value, token.authority);
    }

    function replaceAuthority(next: ArtifactAuthority): void {
      if (sameAuthority(authority.value, next)) return;
      authorityEpoch += 1;
      authority.value = Object.freeze({ ...next });
      sessions.value = Object.freeze({});
    }

    function clearAuthority(): void {
      authorityEpoch += 1;
      authority.value = null;
      sessions.value = Object.freeze({});
    }

    function captureAuthority(): ArtifactAuthorityToken | null {
      if (authority.value === null) return null;
      return Object.freeze({ epoch: authorityEpoch, authority: authority.value });
    }

    function applyProjection(
      token: ArtifactAuthorityToken | null,
      turnId: string,
      artifact: ChatArtifact,
    ): boolean {
      if (!isCurrent(token)) return false;
      sessions.value = updateTurn(
        sessions.value,
        token.authority.sessionId,
        turnId,
        createArtifactProjection(token.authority.sessionId, turnId, artifact),
      );
      return true;
    }

    function ingestHistoryV3(
      token: ArtifactAuthorityToken | null,
      history: ChatHistoryPage,
    ): boolean {
      if (!isCurrent(token)) return false;
      let updated = sessions.value;
      for (const turn of history.turns) {
        for (const artifact of turn.artifacts ?? EMPTY_ARTIFACTS) {
          updated = updateTurn(
            updated,
            token.authority.sessionId,
            turn.turnId,
            createArtifactProjection(token.authority.sessionId, turn.turnId, artifact),
          );
        }
      }
      if (!isCurrent(token)) return false;
      sessions.value = updated;
      return true;
    }

    return {
      authority,
      activeArtifacts,
      artifactsForTurn,
      applyProjection,
      ingestHistoryV3,
      replaceAuthority,
      clearAuthority,
      captureAuthority,
    };
  });
}

export const useArtifactStore = createArtifactStoreDefinition();
