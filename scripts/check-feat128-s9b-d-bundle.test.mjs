import { describe, expect, it } from "vitest";
import {
  FEAT128_S9B_D_BUNDLE_LIMITS,
  validateBundleTotals,
} from "./check-feat128-s9b-d-bundle.mjs";

describe("FEAT-128 S9B-D bundle budget", () => {
  it("accepts the exact boundary and rejects either raw or gzip overflow", () => {
    expect(() => validateBundleTotals({
      rawBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalRawBytes,
      gzipBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalGzipBytes,
      files: 1,
    })).not.toThrow();
    expect(() => validateBundleTotals({
      rawBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalRawBytes + 1,
      gzipBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalGzipBytes,
      files: 1,
    })).toThrow(/raw/i);
    expect(() => validateBundleTotals({
      rawBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalRawBytes,
      gzipBytes: FEAT128_S9B_D_BUNDLE_LIMITS.finalGzipBytes + 1,
      files: 1,
    })).toThrow(/gzip/i);
  });
});
