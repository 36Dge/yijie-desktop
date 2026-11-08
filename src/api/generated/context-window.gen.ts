export interface paths {
    "/v1/agent-sessions/{agent_session_id}/context-window": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read latest native context statistics and context lifecycle
         * @description Owner-only, no-store. Restore the latest persisted native statistics on a cold read, after verifying thread, measured turn, model revision and native context boundary. Repeated native rate-limit samples do not acquire a newer turn or model identity. Unknown or unprovable statistics remain null. include_history reads native items without invoking or resuming a model. Existing clients keep the same closed response shape.
         */
        get: operations["readContextWindow"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description Private Desktop IPC payload inside the existing contextId/requestId envelope. sessionId is the local authorized session, never an arbitrary Runtime thread. */
        ContextWindowQuery: {
            /** Format: uuid */
            sessionId: string;
            includeHistory: boolean;
        };
        ContextWindowSample: {
            /**
             * Format: int64
             * @description Native tokenUsage.last.totalTokens, never tokenUsage.total or a sum of requests. Includes all content counted by Runtime; may be a native recomputation after compaction. Display as latest statistics.
             */
            used_tokens: number;
            /**
             * Format: int64
             * @description Same event's modelContextWindow: Runtime effective capacity, already adjusted by effective_context_window_percent. Null means unknown; no catalog fallback.
             */
            capacity_tokens: number | null;
            turn_id: string;
            /**
             * Format: uuid
             * @description Disposable observation epoch, not a fabricated native window ID. Changes on model binding changes and native contextCompaction start.
             */
            window_id: string;
            /**
             * Format: date-time
             * @description Time of the native observation. Restored samples retain the persisted native event timestamp, never the time the UI was reopened.
             */
            observed_at: string;
        };
        /** @description Original native contextCompaction identity. This native item does not distinguish summarization from new_context; display neutral context-update copy, never invent assistant text/phase or an automatic/manual cause. */
        ContextCompaction: {
            item_id: string;
            turn_id: string;
            /** @enum {string} */
            state: "in_progress" | "completed" | "interrupted" | "unknown";
        };
        ContextWindowSnapshot: {
            /** @enum {integer} */
            schema_version: 1;
            thread_id: string | null;
            model_profile: string | null;
            /** Format: int64 */
            model_revision: number;
            sample: components["schemas"]["ContextWindowSample"] | null;
            compactions: components["schemas"]["ContextCompaction"][];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readContextWindow: {
        parameters: {
            query?: {
                include_history?: boolean;
            };
            header?: never;
            path: {
                agent_session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current observation; null sample is unknown, not zero */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContextWindowSnapshot"];
                };
            };
            /** @description Invalid request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Host authorization required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Runtime unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
