export interface paths {
    "/v1/agent-sessions/{agent_session_id}/user-input": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current pending native questions
         * @description Current pending native questions. Reading does not create or resume a native thread.
         */
        get: operations["getUserInputSnapshot"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/agent-sessions/{agent_session_id}/user-input/{request_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Current request or short-lived content-free receipt; no automatic replay
         * @description Current request or short-lived content-free receipt; no automatic replay. A terminal receipt may expire after ten minutes or bounded-capacity eviction. A valid not_found response together with an authoritative snapshot that no longer lists the request retires only the local form; it does not establish answered/cancelled or authorize replay.
         */
        get: operations["getUserInputRequest"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/agent-sessions/{agent_session_id}/user-input/{request_id}/answer": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Submit once to the bound native request
         * @description Submit once to the bound native request. Identical operation and content is idempotent; conflicting operation is rejected. Success means native transport write completed, not provider consumption. Admission is serialized with the current native turn/request lifecycle. Once native turn completion is known, a new answer is rejected; an already-admitted identical operation may still read its original receipt.
         */
        post: operations["answerUserInput"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/agent-sessions/{agent_session_id}/user-input/{request_id}/touch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pause optional timeout on first actual user interaction
         * @description Pause optional timeout on first actual user interaction. Does not select or submit answers. Native clients require the same task interaction permission as answering (task.read and task.create); read-only permission must not pause the deadline.
         */
        post: operations["pauseUserInputTimeout"];
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
        /** Format: uuid */
        CanonicalID: string;
        /** @description EXPERIMENTAL. Represents one request_user_input question and its required options. */
        ToolRequestUserInputQuestion: {
            header: string;
            id: string;
            /** @default false */
            isOther?: boolean;
            /** @default false */
            isSecret?: boolean;
            options?: components["schemas"]["ToolRequestUserInputOption"][] | null;
            question: string;
        };
        /** @description EXPERIMENTAL. Captures a user's answer to a request_user_input question. */
        ToolRequestUserInputAnswer: {
            answers: string[];
        };
        /** @enum {string} */
        InputState: "pending" | "submitting" | "answered" | "skipped" | "timed_out" | "cancelled" | "unknown";
        UserInputRequest: {
            request_id: components["schemas"]["CanonicalID"];
            turn_id: string;
            item_id: string;
            state: components["schemas"]["InputState"];
            questions: components["schemas"]["ToolRequestUserInputQuestion"][];
            /** Format: date-time */
            deadline_at?: string;
            timeout_paused: boolean;
            operation_id?: components["schemas"]["CanonicalID"];
        };
        UserInputSnapshot: {
            enabled: boolean;
            requests: components["schemas"]["UserInputRequest"][];
            /** @description Current Host Runtime generation; omitted only for an unbound local session. A change invalidates prior pending UI state, never replays answers. */
            generation?: components["schemas"]["CanonicalID"];
        };
        UserInputAnswerRequest: {
            operation_id: components["schemas"]["CanonicalID"];
            /** @description Exact original question IDs only. At most one answer string per question, at most 8192 Unicode characters each. Empty map/arrays skip; never approval. Values go to the original native model/rollout, never additional Host/UI storage. */
            answers: {
                [key: string]: components["schemas"]["ToolRequestUserInputAnswer"];
            };
        };
        /** @description Keep these closed codes across adapters. not_found, conflict and unavailable must remain distinguishable; unknown or malformed errors must never be interpreted as definitive request absence. */
        UserInputError: {
            error: {
                /** @enum {string} */
                code: "invalid_request" | "unavailable" | "not_found" | "conflict" | "unauthorized";
                message: string;
            };
        };
        /** @description EXPERIMENTAL. Params sent with a request_user_input event. */
        ToolRequestUserInputParams: {
            /**
             * Format: int64
             * @default null
             */
            autoResolutionMs?: number | null;
            itemId: string;
            questions: components["schemas"]["ToolRequestUserInputQuestion"][];
            threadId: string;
            turnId: string;
        };
        /** @description EXPERIMENTAL. Defines a single selectable option for request_user_input. */
        ToolRequestUserInputOption: {
            description: string;
            label: string;
        };
        /** @description EXPERIMENTAL. Response payload mapping question ids to answers. */
        ToolRequestUserInputResponse: {
            answers: {
                [key: string]: components["schemas"]["ToolRequestUserInputAnswer"];
            };
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
    getUserInputSnapshot: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_session_id: components["schemas"]["CanonicalID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current native interaction state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputSnapshot"];
                };
            };
            /** @description Invalid bounded input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Host bearer required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Session permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Request absent or from an old Host generation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Ended or different operation; do not replay */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Runtime unavailable; outcome must be queried */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
        };
    };
    getUserInputRequest: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_session_id: components["schemas"]["CanonicalID"];
                request_id: components["schemas"]["CanonicalID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current native interaction state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputRequest"];
                };
            };
            /** @description Invalid bounded input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Host bearer required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Session permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Request absent or from an old Host generation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Ended or different operation; do not replay */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Runtime unavailable; outcome must be queried */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
        };
    };
    answerUserInput: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_session_id: components["schemas"]["CanonicalID"];
                request_id: components["schemas"]["CanonicalID"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UserInputAnswerRequest"];
            };
        };
        responses: {
            /** @description Current native interaction state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputRequest"];
                };
            };
            /** @description Invalid bounded input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Host bearer required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Session permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Request absent or from an old Host generation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Ended or different operation; do not replay */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Runtime unavailable; outcome must be queried */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
        };
    };
    pauseUserInputTimeout: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                agent_session_id: components["schemas"]["CanonicalID"];
                request_id: components["schemas"]["CanonicalID"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Current native interaction state */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputRequest"];
                };
            };
            /** @description Invalid bounded input */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Host bearer required */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Session permission denied */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Request absent or from an old Host generation */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Ended or different operation; do not replay */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
            /** @description Runtime unavailable; outcome must be queried */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserInputError"];
                };
            };
        };
    };
}
