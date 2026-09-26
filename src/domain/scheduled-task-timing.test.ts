import { describe, expect, it } from "vitest";
import { durationLabel, executionTimeLabel, timingNote } from "./scheduled-task-ui";
import type { Timing } from "../api/generated/scheduled-task-ipc.gen";
const clock: Timing = { execution_time: "known", duration: "known", source: "runtime_read", started_at: 1790151297, duration_ms: 440, time_zone: "Asia/Shanghai" };
describe("scheduled native timing display", () => {
  it("keeps subsecond duration and native second resolution without subtracting clocks", () => {
    expect(durationLabel(clock)).toBe("0.44 秒");
    const label = executionTimeLabel(clock);
    expect(label).toContain("16:14:57"); expect(label).toContain("GMT+08:00"); expect(label).toContain("Asia/Shanghai");
    expect(durationLabel({ ...clock, duration_ms: 0 })).toBe("0 秒");
    expect(durationLabel({ ...clock, duration_ms: 61250 })).toBe("1 分 1.25 秒");
    expect(executionTimeLabel({ ...clock, started_at: 0, time_zone: "UTC" })).toContain("00:00:00");
  });
  it("formats compact details using the recorded zone and preserves fallback states", () => {
    expect(executionTimeLabel(clock, true)).toBe("2026-09-23 16:14");
    expect(executionTimeLabel({ ...clock, time_zone: "UTC" }, true)).toBe("2026-09-23 08:14");
    expect(executionTimeLabel({ ...clock, time_zone: "unavailable-zone" }, true)).toContain("UTC，原时区不可用");
    expect(executionTimeLabel({ ...clock, execution_time: "unknown" }, true)).toBe("未知");
  });
  it("rounds compact duration across minute boundaries without hiding subsecond runs", () => {
    expect(durationLabel(clock, true)).toBe("不到 1 秒");
    expect(durationLabel({ ...clock, duration_ms: 0 }, true)).toBe("0 秒");
    expect(durationLabel({ ...clock, duration_ms: 2505 }, true)).toBe("3 秒");
    expect(durationLabel({ ...clock, duration_ms: 59999 }, true)).toBe("1 分 0 秒");
    expect(durationLabel({ ...clock, duration_ms: 61250 }, true)).toBe("1 分 1 秒");
    expect(durationLabel({ ...clock, duration: "unknown" }, true)).toBe("未知");
    expect(durationLabel({ ...clock, duration: "not_started" }, true)).toBe("未开始");
    expect(durationLabel({ ...clock, duration: "in_progress" }, true)).toBe("尚未结束");
  });
  it("preserves unknown, not-started, ongoing and conflicts", () => {
    for (const state of ["unknown", "not_started"] as const) {
      const v: Timing = { execution_time: state, duration: state, source: "no_execution_clock" };
      expect(executionTimeLabel(v)).toBe(state === "unknown" ? "未知" : "未开始");
      expect(durationLabel(v)).toBe(state === "unknown" ? "未知" : "未开始");
    }
    expect(durationLabel({ ...clock, duration: "in_progress" })).toBe("尚未结束");
    expect(durationLabel({ ...clock, duration: "unknown", duration_ms: undefined })).toBe("未知");
    expect(timingNote({ ...clock, diagnostic: "source_conflict" })).toContain("冲突");
  });
  it("uses the snapshot zone and its historical offset, with explicit UTC fallback", () => {
    const zone = "America/New_York";
    expect(executionTimeLabel({ ...clock, time_zone: zone, started_at: Date.parse("2026-03-08T06:59:59Z") / 1000 })).toContain("GMT-05:00");
    expect(executionTimeLabel({ ...clock, time_zone: zone, started_at: Date.parse("2026-03-08T07:00:00Z") / 1000 })).toContain("GMT-04:00");
    expect(executionTimeLabel({ ...clock, time_zone: "unavailable-zone" })).toContain("UTC，原时区不可用");
    expect(executionTimeLabel({ ...clock, started_at: NaN })).toBe("未知");
    expect(durationLabel({ ...clock, duration_ms: -1 })).toBe("未知");
  });
});
