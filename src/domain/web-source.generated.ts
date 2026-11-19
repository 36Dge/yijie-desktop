// Generated from chat-web-source-v1.schema.json; do not edit.
// SHA256 81c64a4b556f08bd5dfecd3c503530cdb48e6c965cf0280244976bfd5ac277ff

export type WebSourceTarget = Readonly<{ sessionId: string; turnId: string; itemId: string; url: string }>;
export type WebSourcePayload = Readonly<{ action: "icon" | "open" | "open_message_link"; target: WebSourceTarget }>;
export type WebSourceRequest = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: WebSourcePayload }>;
export type WebSourceResult = Readonly<{ status: "opened" | "icon" | "unavailable"; icon: string | null }>;
export type WebSourceResponse = Readonly<{ schemaVersion: 1; requestId: string; data: WebSourceResult }>;
