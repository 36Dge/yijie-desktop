import type { HttpsSchemasYijieAiWebRetrievalV1Display as WebRetrievalOutput, SearchSuccess, ErrorOutput } from "./web-retrieval.generated";
import { validateSearchOutput, validateProOutput, validateFetchOutput } from "../api/generated/web-retrieval-validator.gen.js";
import { validateBuiltinWebErrorOutput } from "../api/generated/builtin-web-error-validator.gen.js";
import type { AppErrorOutput } from "./builtin-web.generated";

function readResultText(text: string): unknown {
  try {
    const source = text.replace(/^Wall time: [0-9.]+ seconds\nOutput:\n/, "");
    return JSON.parse(source);
  } catch {
    return null;
  }
}

export function readWebRetrievalResult(tool: string, text: string): WebRetrievalOutput | AppErrorOutput | null {
  const value = readResultText(text);
  if (["kimi_web_search", "kimi_web_search_pro", "kimi_web_fetch"].includes(tool) && validateBuiltinWebErrorOutput(value)) return value;
  const validate = tool === "kimi_web_search" ? validateSearchOutput : tool === "kimi_web_search_pro" ? validateProOutput : tool === "kimi_web_fetch" ? validateFetchOutput : null;
  return validate?.(value) ? value as WebRetrievalOutput : null;
}

export type DeepSearchPreview = SearchSuccess | ErrorOutput | AppErrorOutput;

/** Native Pro receipts contain only the approved source list or a public error. */
export function readDeepSearchPreview(text: string): DeepSearchPreview | null {
  const value = readResultText(text);
  if (validateBuiltinWebErrorOutput(value)) return value;
  if (validateSearchOutput(value) && !("dropped_results" in value)) return value;
  return null;
}
