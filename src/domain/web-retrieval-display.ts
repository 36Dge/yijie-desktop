import type { HttpsSchemasYijieAiWebRetrievalV1Display as WebRetrievalOutput } from "./web-retrieval.generated";
import { validateSearchOutput, validateProOutput, validateFetchOutput } from "../api/generated/web-retrieval-validator.gen.js";
import { validateBuiltinWebErrorOutput } from "../api/generated/builtin-web-error-validator.gen.js";
import type { AppErrorOutput } from "./builtin-web.generated";

export function readWebRetrievalResult(tool: string, text: string): WebRetrievalOutput | AppErrorOutput | null {
  try {
    const source = text.replace(/^Wall time: [0-9.]+ seconds\nOutput:\n/, "");
    const value: unknown = JSON.parse(source);
    if (["kimi_web_search", "kimi_web_search_pro", "kimi_web_fetch"].includes(tool) && validateBuiltinWebErrorOutput(value)) return value;
    const validate = tool === "kimi_web_search" ? validateSearchOutput : tool === "kimi_web_search_pro" ? validateProOutput : tool === "kimi_web_fetch" ? validateFetchOutput : null;
    return validate?.(value) ? value as WebRetrievalOutput : null;
  } catch {
    return null;
  }
}
