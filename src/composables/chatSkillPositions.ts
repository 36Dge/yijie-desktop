import { shallowReactive } from "vue";
import type { SubmittedSkillText } from "../domain/chat-skills";

// A presentation receipt for an accepted local turn. The authorized message
// supplies the text and skill identities. Only numeric offsets live here.
const legacyPrefix = "yijie.desktop.ui.skill-positions.v1:";
const markerPrefix = "yijie.desktop.ui.skill-positions.v2:";
interface Placement { length: number; offsets: number[] }
const recent = shallowReactive(new Map<string, Placement>());

export function rememberSubmittedSkillText(session: string, turn: string, submission: SubmittedSkillText) {
  if (!submission.markerStarts.length || !submission.text.includes("【技能")) return;
  const key = `${markerPrefix}${session}:${turn}`;
  const value = { length: submission.text.length, offsets: [...submission.markerStarts] };
  recent.set(key, value);
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* usable for this visit */ }
}

function readPlacement(key: string, length: number, minimum: number, count?: number): number[] | undefined {
  try {
    const value = recent.get(key) ?? JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (value?.length === length && Array.isArray(value.offsets) && value.offsets.length <= 256 &&
      (count === undefined || value.offsets.length === count) &&
      value.offsets.every((offset: number) => Number.isSafeInteger(offset) && offset >= minimum && offset <= length)) return value.offsets;
  } catch { /* Older messages and unavailable preferences retain the original presentation. */ }
}

export function readSkillPositions(session: string, turn: string, length: number, count: number) {
  return readPlacement(`${legacyPrefix}${session}:${turn}`, length, 0, count);
}

export function readSubmittedSkillMarkers(session: string, turn: string, length: number) {
  return readPlacement(`${markerPrefix}${session}:${turn}`, length, -1);
}

export function forgetSessionSkillPositions(session: string) {
  const belongsToSession = (key: string) => key.startsWith(`${legacyPrefix}${session}:`) || key.startsWith(`${markerPrefix}${session}:`);
  for (const key of recent.keys()) if (belongsToSession(key)) recent.delete(key);
  try {
    const storage = window.localStorage;
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key && belongsToSession(key)) storage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}
