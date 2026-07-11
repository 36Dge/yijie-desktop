import { describe, expect, it } from "vitest";
import { sampleTasks } from "./tasks";

describe("sampleTasks", () => {
  it("uses unique IDs and known task states", () => {
    const ids = sampleTasks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(sampleTasks.map((task) => task.status)).toContain("waiting_approval");
  });
});
