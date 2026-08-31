import { describe, expect, it } from "vitest";
import {
  isStrictRfc3339,
  parseStrictRfc3339EpochNanoseconds,
} from "./rfc3339";

describe("strict RFC3339 calendar parser", () => {
  it.each([
    "2024-02-29T23:59:59Z",
    "2000-02-29T00:00:00Z",
    "2026-03-01T00:00:00.1+08:00",
    "2026-03-01T00:00:00.123456789-07:30",
    "9999-12-31T23:59:59.999999999+23:59",
  ])("accepts the closed calendar and offset profile: %s", (value) => {
    expect(isStrictRfc3339(value)).toBe(true);
  });

  it.each([
    "0000-01-01T00:00:00Z",
    "2026-02-29T00:00:00Z",
    "2100-02-29T00:00:00Z",
    "2026-02-31T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00.1234567890Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00+23:60",
    "2026-01-01T00:00:00",
  ])("rejects impossible or widened RFC3339 input: %s", (value) => {
    expect(isStrictRfc3339(value)).toBe(false);
  });

  it("preserves offset and nanosecond equality", () => {
    expect(parseStrictRfc3339EpochNanoseconds(
      "2026-03-01T00:00:00.123456789+08:00",
    )).toBe(parseStrictRfc3339EpochNanoseconds(
      "2026-02-28T16:00:00.123456789Z",
    ));
  });
});
