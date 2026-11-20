// Generated from chat-web-source-v1.schema.json; do not edit.
// SHA256 3293ddf6c6a1ef3d96e746430f1a6d32e6653bb6092fee562516ac42b202fa95

export type WebSourceTarget = Readonly<{ sessionId: string; turnId: string; itemId: string; url: string }>;
export type WebSourcePayload = Readonly<{ action: "icon" | "open" | "open_message_link" | "open_user_message_link"; target: WebSourceTarget }>;
export type WebSourceRequest = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: WebSourcePayload }>;
export type WebSourceResult = Readonly<{ status: "opened" | "icon" | "unavailable"; icon: string | null }>;
export type WebSourceResponse = Readonly<{ schemaVersion: 1; requestId: string; data: WebSourceResult }>;
