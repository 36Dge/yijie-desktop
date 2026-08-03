import { describe, expect, it } from "vitest";
import { safeRelativePath, sha256, validateLock } from "./generate-public-api.mjs";

const validLock = {
  schema_version: 1,
  contract_version: "0.3.0-candidate",
  repository: "https://github.com/36Dge/yijie-contracts.git",
  full_commit: "29317b6426578749dc698fc2ad32b986ee5c8e9f",
  source_path: "openapi/public/public.yaml",
  source_sha256: "b".repeat(64),
  generator: {
    package: "openapi-typescript",
    version: "7.13.0",
    typescript_version: "5.9.3",
    command: "pnpm --dir tools/public-api-generator exec openapi-typescript openapi/public/public.yaml",
  },
  generated_path: "src/api/generated/public.gen.ts",
  generated_sha256: "c".repeat(64),
  fixtures: [
    "capability-v1-empty.json",
    "capability-v1-ready.json",
    "capability-v1-unknown.json",
    "error-authorization-unavailable.json",
    "error-internal-error.json",
    "error-invalid-tenant-context.json",
    "error-tenant-access-denied.json",
    "error-unauthorized.json",
    "error-user-access-denied.json",
    "tenant-list-v1-empty.json",
    "tenant-list-v1-multiple.json",
    "tenant-list-v1-single.json",
  ].map((name) => ({
    path: `tests/fixtures/public/access/${name}`,
    sha256: "d".repeat(64),
  })).concat(
    [
      "create-request.json",
      "error-access-denied.json",
      "error-task-not-found.json",
      "task-response.json",
    ].map((name) => ({
      path: `tests/fixtures/public/tasks-v2/${name}`,
      sha256: "d".repeat(64),
    })),
  ),
};

describe("Public API contract pin", () => {
  it("accepts the complete immutable pin and hashes bytes deterministically", () => {
    expect(validateLock(structuredClone(validLock))).toEqual(validLock);
    expect(sha256("yijie")).toBe(
      "8c02bb5a59c6def6ab883dc47f7b6eac9c022a0c005c6f083ad8a22778633bb6",
    );
  });

  it("rejects abbreviated or non-hex commits and generator drift", () => {
    expect(() => validateLock({ ...validLock, full_commit: "a".repeat(39) })).toThrow();
    expect(() => validateLock({ ...validLock, full_commit: "z".repeat(40) })).toThrow();
    expect(() =>
      validateLock({
        ...validLock,
        generator: { ...validLock.generator, version: "latest" },
      }),
    ).toThrow();
    expect(() =>
      validateLock({
        ...validLock,
        generator: { ...validLock.generator, typescript_version: "latest" },
      }),
    ).toThrow();
  });

  it("rejects source, output and fixture traversal", () => {
    expect(() => safeRelativePath("../public.yaml")).toThrow();
    expect(() => validateLock({ ...validLock, generated_path: "/tmp/public.gen.ts" })).toThrow();
    expect(() =>
      validateLock({
        ...validLock,
        fixtures: [
          ...validLock.fixtures.slice(0, -1),
          { path: "../../fixture.json", sha256: "d".repeat(64) },
        ],
      }),
    ).toThrow();
  });
});
