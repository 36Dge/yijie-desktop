import { invoke } from "@tauri-apps/api/core";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import type { ChatArtifactVideoNativeClient } from "../api/chat-artifact-video-native-client";
import { chatArtifactVideoNativeClient } from "../api/chat-artifact-video-native-client";
import ChatArtifactShell from "../components/chat/ChatArtifactShell.vue";
import { createArtifactProjection } from "../domain/chat-artifact";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DISPLAY_NAME = /^[^\0/\\]{1,255}$/;
const FAILURE_CODES = new Set([
  "runtime_bootstrap_failed",
  "runtime_clock_invalid",
  "runtime_context_invalid",
  "runtime_database_invalid",
  "runtime_database_configuration_invalid",
  "runtime_database_disabled",
  "runtime_database_initialization_invalid",
  "runtime_database_key_missing",
  "runtime_database_migration_failed",
  "runtime_database_open_invalid",
  "runtime_database_storage_unavailable",
  "runtime_database_unsafe",
  "runtime_fixture_invalid",
  "runtime_media_missing",
  "runtime_metadata_timeout",
  "runtime_metadata_failed",
  "runtime_metadata_media_error_1",
  "runtime_metadata_media_error_2",
  "runtime_metadata_media_error_3",
  "runtime_metadata_media_error_4",
  "runtime_playback_failed",
  "runtime_playback_timeout",
  "runtime_seek_failed",
  "runtime_seek_timeout",
  "runtime_seed_failed",
  "runtime_storage_profile_invalid",
]);

export interface S7bRuntimeSeed {
  readonly schemaVersion: 1;
  readonly contextId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly artifactId: string;
  readonly displayName: string;
}

export interface S7bRuntimeObservation {
  readonly schemaVersion: 1;
  readonly status: "passed" | "failed";
  readonly metadataReady: boolean;
  readonly playbackStarted: boolean;
  readonly seeked: boolean;
  readonly failureCode: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("runtime_seed_invalid");
  return value as Record<string, unknown>;
}

export function parseS7bRuntimeSeed(value: unknown): S7bRuntimeSeed {
  const parsed = record(value);
  const keys = ["schemaVersion", "contextId", "sessionId", "turnId", "artifactId", "displayName"];
  if (Object.keys(parsed).sort().join("\0") !== keys.sort().join("\0") || parsed.schemaVersion !== 1) {
    throw new Error("runtime_seed_invalid");
  }
  for (const key of ["contextId", "sessionId", "turnId", "artifactId"] as const) {
    if (typeof parsed[key] !== "string" || !UUID.test(parsed[key])) throw new Error("runtime_seed_invalid");
  }
  if (typeof parsed.displayName !== "string" || !DISPLAY_NAME.test(parsed.displayName)) {
    throw new Error("runtime_seed_invalid");
  }
  return Object.freeze(parsed as unknown as S7bRuntimeSeed);
}

export function runtimeObservation(
  status: "passed" | "failed",
  failureCode: string | null,
): S7bRuntimeObservation {
  if ((status === "passed" && failureCode !== null) ||
      (status === "failed" && (failureCode === null || !FAILURE_CODES.has(failureCode)))) {
    throw new Error("runtime_observation_invalid");
  }
  const passed = status === "passed";
  return Object.freeze({
    schemaVersion: 1,
    status,
    metadataReady: passed,
    playbackStarted: passed,
    seeked: passed,
    failureCode,
  });
}

function once(target: EventTarget, event: string, timeoutMs: number, timeoutCode: string): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      target.removeEventListener(event, onEvent);
      reject(new Error(timeoutCode));
    }, timeoutMs);
    const onEvent = (value: Event) => {
      window.clearTimeout(timeout);
      target.removeEventListener(event, onEvent);
      resolve(value);
    };
    target.addEventListener(event, onEvent, { once: true });
  });
}

function mediaReadyOrError(
  media: HTMLVideoElement,
  readyEvent: string,
  timeoutMs: number,
  timeoutCode: string,
  errorCode: string,
): Promise<Event> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(() => reject(new Error(timeoutCode))), timeoutMs);
    const ready = (event: Event) => finish(() => resolve(event));
    const failed = () => {
      const mediaCode = media.error?.code;
      const stableCode = typeof mediaCode === "number" && mediaCode >= 1 && mediaCode <= 4
        ? `runtime_metadata_media_error_${mediaCode}`
        : errorCode;
      finish(() => reject(new Error(stableCode)));
    };
    const finish = (complete: () => void) => {
      window.clearTimeout(timeout);
      media.removeEventListener(readyEvent, ready);
      media.removeEventListener("error", failed, true);
      complete();
    };
    media.addEventListener(readyEvent, ready, { once: true });
    media.addEventListener("error", failed, { capture: true, once: true });
  });
}

async function waitForMedia(root: Element, timeoutMs: number): Promise<HTMLVideoElement> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const video = root.querySelector<HTMLVideoElement>("[data-testid='artifact-video-media']");
    if (video) return video;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
  }
  throw new Error("runtime_media_missing");
}

async function report(observation: S7bRuntimeObservation): Promise<void> {
  await invoke("feat128_s7b_runtime_result", { observation });
}

async function runPlaybackSmoke(root: Element): Promise<void> {
  await nextTick();
  const video = await waitForMedia(root, 10_000);
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
    await mediaReadyOrError(video, "loadedmetadata", 15_000, "runtime_metadata_timeout", "runtime_metadata_failed");
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("runtime_metadata_timeout");

  video.muted = true;
  const playing = once(video, "playing", 10_000, "runtime_playback_timeout");
  await video.play().catch(() => { throw new Error("runtime_playback_failed"); });
  await playing;
  video.pause();

  const target = Math.min(Math.max(video.duration / 2, 0.05), Math.max(video.duration - 0.01, 0.05));
  const seeked = once(video, "seeked", 10_000, "runtime_seek_timeout");
  try { video.currentTime = target; } catch { throw new Error("runtime_seek_failed"); }
  await seeked;
  if (!Number.isFinite(video.currentTime) || video.currentTime <= 0) throw new Error("runtime_seek_failed");
}

export async function mountFeat128S7bRuntimeHarness(
  root: Element,
  videoClient: ChatArtifactVideoNativeClient = chatArtifactVideoNativeClient,
): Promise<App> {
  let seed: S7bRuntimeSeed;
  try {
    seed = parseS7bRuntimeSeed(await invoke("feat128_s7b_runtime_seed"));
  } catch (error: unknown) {
    const code = typeof error === "string" && FAILURE_CODES.has(error)
      ? error
      : "runtime_bootstrap_failed";
    await report(runtimeObservation("failed", code));
    throw Object.assign(new Error("runtime_bootstrap_failed"), { cause: error });
  }
  const artifact = createArtifactProjection(seed.sessionId, seed.turnId, Object.freeze({
    artifactId: seed.artifactId,
    kind: "video" as const,
    provenance: "synthetic" as const,
    status: "ready" as const,
    ordinal: 0,
    progressStage: null,
    progressPercent: null,
    displayName: seed.displayName,
    mediaType: "video/mp4",
    sizeBytes: 1_642,
    localCommittedAt: 1,
    expiresAt: 604_801_000,
    hasPoster: false,
    errorCode: null,
    retryable: null,
  }));
  const Harness = defineComponent({
    name: "Feat128S7bRuntimeHarness",
    setup: () => () => h("main", { "data-feat128-s7b-runtime": "" }, [
      h(ChatArtifactShell, {
        artifact,
        contextId: seed.contextId,
        videoNativeClient: videoClient,
      }),
    ]),
  });
  const app = createApp(Harness);
  app.mount(root);
  void runPlaybackSmoke(root).then(
    () => report(runtimeObservation("passed", null)),
    (error: unknown) => {
      const code = error instanceof Error && FAILURE_CODES.has(error.message)
        ? error.message
        : "runtime_playback_failed";
      return report(runtimeObservation("failed", code));
    },
  );
  return app;
}
