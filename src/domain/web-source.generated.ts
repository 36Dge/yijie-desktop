// Generated from chat-web-source-v1.schema.json; do not edit.
// SHA256 ca1d2a6c3aa96b1eae8d2d124df986115d509bf2dea931129538f417ade01af3

export type WebSourceTarget = Readonly<{ sessionId: string; turnId: string; itemId: string; url: string }>;
export type WebSourcePayload = Readonly<{ action: "icon" | "open" | "open_message_link"; target: WebSourceTarget }>;
export type WebSourceRequest = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: WebSourcePayload }>;
export type WebSourceResult = Readonly<{ status: "opened" | "icon" | "unavailable"; icon: string | null }>;
export type WebSourceResponse = Readonly<{ schemaVersion: 1; requestId: string; data: WebSourceResult }>;
