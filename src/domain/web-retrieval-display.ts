import type { HttpsSchemasYijieAiWebRetrievalV1Display as WebRetrievalOutput, SearchSuccess, ErrorOutput } from "./web-retrieval.generated";
import { validateSearchOutput, validateProOutput, validateFetchOutput } from "../api/generated/web-retrieval-validator.gen.js";
import { validateBuiltinWebErrorOutput } from "../api/generated/builtin-web-error-validator.gen.js";
import type { AppErrorOutput } from "./builtin-web.generated";

function readResultText(text: string): unknown {
  try {
    const source = text.replace(/^Wall time: [0-9.]+ seconds\nOutput:\n/, "").trimStart();
    return source.startsWith("{") ? JSON.parse(source) : null;
  } catch {
    return null;
  }
}

function retrievalValidator(tool: string | undefined) {
  switch (tool) {
    case "kimi_web_search": return validateSearchOutput;
    case "kimi_web_search_pro": return validateProOutput;
    case "kimi_web_fetch": return validateFetchOutput;
    default: return null;
  }
}

export function readWebRetrievalResult(tool: string, text: string): WebRetrievalOutput | AppErrorOutput | null {
  const validate = retrievalValidator(tool);
  if (!validate) return null;
  const value = readResultText(text);
  if (validateBuiltinWebErrorOutput(value)) return value;
  return validate(value) ? value as WebRetrievalOutput : null;
}

export function hasWebRetrievalError(tool: string | undefined, text: string | undefined): boolean {
  const validate = retrievalValidator(tool);
  if (!text || !validate) return false;
  const value = readResultText(text);
  return typeof value === "object" && value !== null && "error" in value &&
    (validateBuiltinWebErrorOutput(value) || validate(value));
}

export type DeepSearchPreview = SearchSuccess | ErrorOutput | AppErrorOutput;

/** Native Pro receipts contain only the approved source list or a public error. */
export function readDeepSearchPreview(text: string): DeepSearchPreview | null {
  const value = readResultText(text);
  if (validateBuiltinWebErrorOutput(value)) return value;
  if (validateSearchOutput(value) && !("dropped_results" in value)) return value;
  return null;
}
