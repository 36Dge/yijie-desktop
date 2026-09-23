import { expect, it } from "vitest";
import { isScheduledHostCandidate } from "./scheduled-host-build-candidate.mjs";
it("keeps the reviewed candidate source exception local and explicit", () => {
  const env={YIJIE_FEAT155_SCHEDULED_CANDIDATE:"true",YIJIE_ENV:"local",YIJIE_LOCAL_PROFILE:"demo_fast"};
  expect(isScheduledHostCandidate(env)).toBe(true);
  expect(isScheduledHostCandidate({})).toBe(false);
  for(const key of Object.keys(env)) expect(isScheduledHostCandidate({...env,[key]:""})).toBe(false);
  expect(isScheduledHostCandidate({...env,YIJIE_ENV:"production"})).toBe(false);
});
