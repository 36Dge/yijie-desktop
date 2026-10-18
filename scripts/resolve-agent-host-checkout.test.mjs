import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveAgentHostCheckout } from "./resolve-pinned-checkout.mjs";

const repositoryRoot = path.resolve("/workspace/yijie-desktop");
const fullCommit = "1b7bfd1ce4323e52035b2ba1e62842c2d332d9ed";
const sibling = path.resolve(repositoryRoot, "../yijie-agent-host");
const pinned = path.join(repositoryRoot, ".local", "agent-host-pinned-1b7bfd1");
const options = { repositoryRoot, fullCommit };

describe("Agent Host immutable source selection", () => {
  it("honors an explicit source without silently falling back", async () => {
    const readHead = vi.fn();
    expect(await resolveAgentHostCheckout({ ...options, explicitRoot: "../chosen-host" }, readHead))
      .toBe(path.resolve(repositoryRoot, "../chosen-host"));
    expect(readHead).not.toHaveBeenCalled();
  });

  it("keeps an exact sibling for the downstream clean/origin/digest checks", async () => {
    const readHead = vi.fn().mockResolvedValue(fullCommit);
    expect(await resolveAgentHostCheckout(options, readHead)).toBe(sibling);
    expect(readHead.mock.calls).toEqual([[sibling]]);
  });

  it("selects the reviewed historical source after the development sibling advances", async () => {
    const readHead = vi.fn().mockResolvedValueOnce("9acae49ee2bf1fb33ae1da8ef02fd0bd07538d63").mockResolvedValueOnce(fullCommit);
    expect(await resolveAgentHostCheckout(options, readHead)).toBe(pinned);
    expect(readHead.mock.calls).toEqual([[sibling], [pinned]]);
  });

  it("uses an existing exact checkout when the sibling is absent", async () => {
    const readHead = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(fullCommit);
    expect(await resolveAgentHostCheckout(options, readHead)).toBe(pinned);
  });

  it("requires preparation of the actual commit instead of accepting a directory name", async () => {
    const readHead = vi.fn().mockResolvedValue("9acae49ee2bf1fb33ae1da8ef02fd0bd07538d63");
    await expect(resolveAgentHostCheckout(options, readHead)).rejects.toThrow(
      `Prepare a clean checkout of that commit at ${pinned}`,
    );
  });

  it("uses each contract's own full commit, including the independent v4 baseline", async () => {
    const v4 = "96b1fa19783694aef583b614c492fd2b6b5c15cc";
    const readHead = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(v4);
    expect(await resolveAgentHostCheckout({ ...options, fullCommit: v4 }, readHead))
      .toBe(path.join(repositoryRoot, ".local", "agent-host-pinned-96b1fa1"));
  });

  it("does not accept an abbreviated or floating reference", async () => {
    const readHead = vi.fn();
    await expect(resolveAgentHostCheckout({ ...options, fullCommit: "develop" }, readHead))
      .rejects.toThrow("complete pinned Git commit");
    expect(readHead).not.toHaveBeenCalled();
  });
});
