import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, test } from "vitest";

test("browser bundle validates native Items and preserves Unicode length limits", async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: {
        entry: fileURLToPath(new URL("../src/api/generated/native-conversation-validator.gen.js", import.meta.url)),
        formats: ["es"],
      },
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap(value => value.output) : result.output;
  const chunk = outputs.find(value => value.type === "chunk" && value.isEntry);
  expect(chunk).toBeDefined();
  const validator = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`);
  const view = {
    sessionId: "local-session", turnId: "local-turn",
    runtimeThreadId: "native-thread", runtimeTurnId: "native-turn",
    source: "native_observed", revision: "1", availability: "available",
    status: "completed", terminalObserved: true,
    items: [{
      item: { id: "native-item", type: "agentMessage", text: "真实结果 🌱", phase: "final_answer", availability: "available" },
      ordinal: 0, lastMethod: "item/completed",
    }],
  };
  const event = { schemaVersion: 1, contextId: "context", subscriptionId: "subscription", sessionId: view.sessionId, view };
  const history = { views: [view], submissions: [], remainingTurnIds: [], historyAvailability: "partial" };
  expect(validator.validateNativeViewEvent(event)).toBe(true);
  expect(validator.validateNativeHistory(history)).toBe(true);
  view.items[0].item.id = "🌱".repeat(512);
  expect(validator.validateNativeViewEvent(event)).toBe(true);
  view.items[0].item.id += "🌱";
  expect(validator.validateNativeViewEvent(event)).toBe(false);
  expect(validator.validateNativeHistory(history)).toBe(false);
});
