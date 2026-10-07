import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSkillsCheckout } from "./resolve-skills-checkout.mjs";

const repositoryRoot = path.resolve("/workspace/yijie-desktop");
const fullCommit = "10c45bec29603b002e861e1499d5b4e684251af5";
const sibling = path.resolve(repositoryRoot, "../yijie-skills");
const pinned = path.join(repositoryRoot, ".local", "skills-pinned-10c45be");
const options = { repositoryRoot, fullCommit };

describe("Skills checkout selection", () => {
  it("preserves an explicit source so its consumer can validate it without fallback", async () => {
    const readHead = vi.fn();
    expect(await resolveSkillsCheckout({ ...options, explicitRoot: "../selected-skills" }, readHead))
      .toBe(path.resolve(repositoryRoot, "../selected-skills"));
    expect(readHead).not.toHaveBeenCalled();
  });

  it("prefers the sibling when it is at the reviewed commit", async () => {
    const readHead = vi.fn().mockResolvedValue(fullCommit);
    expect(await resolveSkillsCheckout(options, readHead)).toBe(sibling);
    expect(readHead.mock.calls).toEqual([[sibling]]);
  });

  it("uses the exact pinned checkout after the sibling advances", async () => {
    const readHead = vi.fn().mockResolvedValueOnce("488714a8d96f40806a257aae097683815b1dd458").mockResolvedValueOnce(fullCommit);
    expect(await resolveSkillsCheckout(options, readHead)).toBe(pinned);
    expect(readHead.mock.calls).toEqual([[sibling], [pinned]]);
  });

  it("supports an existing pinned checkout when there is no sibling", async () => {
    const readHead = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(fullCommit);
    expect(await resolveSkillsCheckout(options, readHead)).toBe(pinned);
  });

  it("requires an exact source and explains how to prepare a missing checkout", async () => {
    const readHead = vi.fn().mockResolvedValue(null);
    await expect(resolveSkillsCheckout(options, readHead)).rejects.toThrow(`Prepare a clean checkout of that commit at ${pinned}`);
  });

  it("does not select a checkout by its directory name alone", async () => {
    const readHead = vi.fn().mockResolvedValue("488714a8d96f40806a257aae097683815b1dd458");
    await expect(resolveSkillsCheckout(options, readHead)).rejects.toThrow(`Skills requires pinned commit ${fullCommit}`);
  });
});
