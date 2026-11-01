import { invoke } from "@tauri-apps/api/core";
import type { WebSourcePayload, WebSourceRequest, WebSourceResponse, WebSourceResult } from "../domain/web-source.generated";

type Invoker = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export function createWebSourceClient(nativeInvoke: Invoker = invoke) {
  return async (contextId: string, payload: WebSourcePayload): Promise<WebSourceResult> => {
    const request: WebSourceRequest = {schemaVersion: 1, requestId: crypto.randomUUID(), contextId, payload};
    const response = await nativeInvoke("chat_web_source_v1", {request}) as WebSourceResponse;
    if (!response || response.schemaVersion !== 1 || response.requestId !== request.requestId || !response.data ||
      !(payload.action === "open" ? ["opened"] : ["icon", "unavailable"]).includes(response.data.status) ||
      (response.data.status === "icon" ? typeof response.data.icon !== "string" || response.data.icon.length > 131072 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(response.data.icon) : response.data.icon !== null)) {
      throw new Error("web_source_unavailable");
    }
    return response.data;
  };
}
export const webSourceClient = createWebSourceClient();
