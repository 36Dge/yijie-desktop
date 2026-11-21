// Generated from chat-document-preview-v1.schema.json; do not edit.
// SHA256 2785064d84daa2fae3f068bcc4531e2afad556e1a7b4ae643fcf38f5d15816de

export type Source = ArtifactSource | AttachmentSource | MessageFileSource;
export type Viewport = Readonly<{ x: number; y: number; width: number; height: number; dpr: number }>;
export type Location = Readonly<{ section: number; offset: number; zoom: number; scrollX: number; scrollY: number; revision: string | null; viewMode?: "layout" | "content" }>;
export type Section = Readonly<{ id: number; label: string }>;
export type Action = Readonly<{ action: "open"; viewId: string; source: Source; viewport: Viewport; location: Location; theme: "light" | "dark" }> | Readonly<{ action: "resize"; viewId: string; viewport: Viewport; visible: boolean }> | Readonly<{ action: "position"; viewId: string }> | Readonly<{ action: "close"; viewId: string }> | Readonly<{ action: "locate"; viewId: string; source: MessageFileSource }> | Readonly<{ action: "save"; viewId: string; source: Source; revision: string }> | Readonly<{ action: "locate"; viewId: string; source: StoredSource; revision: string }> | Readonly<{ action: "saveMessageFile"; viewId: string; source: MessageFileSource }>;
export type Request = Readonly<{ schemaVersion: 1; requestId: string; contextId: string; payload: Action }>;
export type Document = Readonly<{ kind: "html" | "text" | "docx" | "pptx" | "xlsx" | "pdf" | "image" | "video"; revision: string; expiresAt: number; sections: readonly (Section)[]; section: number; offset: number; nextOffset: number | null; previousOffset: number | null; partial: boolean; notice: string | null; viewMode?: "layout" | "content"; availableModes?: readonly ("layout" | "content")[]; saveSupported?: boolean; locationSupported?: boolean }>;
export type Position = Readonly<{ scrollX: number; scrollY: number }>;
export type Result = Readonly<{ status: "ready" | "resized" | "position" | "closed" | "located" | "saved" | "cancelled"; viewId: string; document: Document | null; position: Position | null; path?: string; fileInfo?: MessageFileInfo }>;
export type Response = Readonly<{ schemaVersion: 1; requestId: string; data: Result }>;
export type Invalidated = Readonly<{ viewId: string; reason: "expired" | "forbidden" | "unavailable" }>;
export type Loaded = Readonly<{ viewId: string }>;
export type MessageFileSource = Readonly<{ kind: "messageFile"; sessionId: string; turnId: string; itemId: string; reference: string }>;
export type ArtifactSource = Readonly<{ kind: "artifact"; sessionId: string; turnId: string; artifactId: string }>;
export type AttachmentSource = Readonly<{ kind: "attachment"; sessionId: string; messageId: string | null; attachmentId: string }>;
export type StoredSource = ArtifactSource | AttachmentSource;
export type MessageFileInfo = Readonly<{ sizeBytes: number; saveSupported: boolean }>;
