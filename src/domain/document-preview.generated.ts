// Generated from chat-document-preview-v1.schema.json; do not edit.
// SHA256 3415f029b96d5c1015e6aa3985ef77ecc0e2c3a3bba0f8d91828ac9ff1b93a00

export type Source = Readonly<{ kind: "artifact"; sessionId: string; turnId: string; artifactId: string }> | Readonly<{ kind: "attachment"; sessionId: string; messageId: string | null; attachmentId: string }> | MessageFileSource;
export type Viewport = Readonly<{ x: number; y: number; width: number; height: number; dpr: number }>;
export type Location = Readonly<{ section: number; offset: number; zoom: number; scrollX: number; scrollY: number; revision: string | null; viewMode?: "layout" | "content" }>;
export type Section = Readonly<{ id: number; label: string }>;
export type Action = Readonly<{ action: "open"; viewId: string; source: Source; viewport: Viewport; location: Location; theme: "light" | "dark" }> | Readonly<{ action: "resize"; viewId: string; viewport: Viewport; visible: boolean }> | Readonly<{ action: "position"; viewId: string }> | Readonly<{ action: "close"; viewId: string }> | Readonly<{ action: "locate"; viewId: string; source: MessageFileSource }>;
export type Request = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: Action }>;
export type Document = Readonly<{ kind: "html" | "text" | "docx" | "pptx" | "xlsx" | "pdf" | "image" | "video"; revision: string; expiresAt: number; sections: readonly (Section)[]; section: number; offset: number; nextOffset: number | null; previousOffset: number | null; partial: boolean; notice: string | null; viewMode?: "layout" | "content"; availableModes?: readonly ("layout" | "content")[] }>;
export type Position = Readonly<{ scrollX: number; scrollY: number }>;
export type Result = Readonly<{ status: "ready" | "resized" | "position" | "closed" | "located"; viewId: string; document: Document | null; position: Position | null; path?: string }>;
export type Response = Readonly<{ schemaVersion: 1; requestId: string; data: Result }>;
export type Invalidated = Readonly<{ viewId: string; reason: "expired" | "forbidden" | "unavailable" }>;
export type Loaded = Readonly<{ viewId: string }>;
export type MessageFileSource = Readonly<{ kind: "messageFile"; sessionId: string; turnId: string; itemId: string; reference: string }>;
