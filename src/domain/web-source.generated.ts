// Generated from chat-web-source-v1.schema.json; do not edit.
// SHA256 195cba2179205f8f30018950332883a8db0bfe016693301b3cac44bba94f2343

export type WebSourceTarget = Readonly<{ sessionId: string; turnId: string; itemId: string; url: string }>;
export type WebSourcePayload = Readonly<{ action: "icon" | "open"; target: WebSourceTarget }>;
export type WebSourceRequest = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: WebSourcePayload }>;
export type WebSourceResult = Readonly<{ status: "opened" | "icon" | "unavailable"; icon: string | null }>;
export type WebSourceResponse = Readonly<{ schemaVersion: 1; requestId: string; data: WebSourceResult }>;
